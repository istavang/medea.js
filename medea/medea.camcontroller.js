
/* medea - an Open Source, WebGL-based 3d engine for next-generation browser games.
 * (or alternatively, for clumsy and mostly useless tech demos written solely for fun)
 *
 * medea is (c) 2011, Alexander C. Gessler
 * licensed under the terms and conditions of a 3 clause BSD license.
 */

medea._addMod('camcontroller',['entity','input'],function(undefined) {
	"use strict";
	var medea = this;

	medea._initMod('entity');
	
	
	medea.CamController = medea.Entity.extend({

		enabled: false,
		turn_speed : 0.005,
		walk_speed : 5.5,
		last_processed_mdelta : -1,
		last_processed_mwdelta : -1,

		init : function(enabled) {
			this._super();
			this.Enabled(enabled || false);
		},


		Enabled : medea._GetSet('enabled'),
		

		// TODO: deprecate in favour of Enabled()
		Enable : function(enable) {
			this.enabled = true;
		},

		Disable : function(enable) {
			this.enabled = false;
		},
		
		
		Update : function(dtime, node) {
			if(!this.enabled || medea.IsMouseDown()) {
				return;
			}

			var d = medea.GetMouseDelta();
			if(d[2] !== this.last_processed_mdelta) {
			
				// do not process mouse movements while the CTRL key is pressed
				if (!medea.IsKeyDown(17)) {
					this.ProcessMouseDelta(dtime, node, d);
				}
				this.last_processed_mdelta = d[2];
			}

			d = medea.GetMouseWheelDelta();
			if(d[1] !== this.last_processed_mwdelta) {

				// do not process mouse movements while the CTRL key is pressed
				if (!medea.IsKeyDown(17)) {
					this.ProcessMouseWheel(dtime, node, d[0]);
				}

				this.last_processed_mwdelta = d[1];
			}
			
			this.ProcessKeyboard(dtime, node);
		},
		
		
		ProcessMouseDelta : function(dtime, node, d) {
		},

		ProcessMouseWheel : function(dtime, node, z) {
		},
		
		ProcessKeyboard : function(dtime, node) {
		}
	});


	
	medea.FpsCamController = medea.CamController.extend({

		enabled: false,
		turn_speed : 0.005,
		walk_speed : 5.5,

		terrain_entity : null,

		init : function(enabled) {
			this._super(enabled);
		},

	
		TurnSpeed : medea._GetSet('turn_speed'),
		WalkSpeed : medea._GetSet('walk_speed'),
		TerrainEntity : medea._GetSet('terrain_entity'),


		ProcessMouseDelta : function(dtime, n, d) {
			var mrot;

			// process mouse movement on the y axis
			if(d[1]) {
				mrot = mat4.rotate(mat4.identity(mat4.create()),-d[1]*this.turn_speed,n.LocalXAxis());
				n.LocalYAxis(mat4.multiplyVec3(mrot,n.LocalYAxis()));
				n.LocalZAxis(mat4.multiplyVec3(mrot,n.LocalZAxis()));
			}

			// process mouse movement on the x axis
			if(d[0]) {
				mrot = mat4.rotate(mat4.identity(mat4.create()),-d[0]*this.turn_speed,[0,1,0]);
				n.LocalYAxis(mat4.multiplyVec3(mrot,n.LocalYAxis()));
				n.LocalZAxis(mat4.multiplyVec3(mrot,n.LocalZAxis()));
				n.LocalXAxis(vec3.cross(n.LocalYAxis(),n.LocalZAxis()));
			}
		},
			

		ProcessKeyboard : function(dtime, n) {

			var ws = this.walk_speed;
			if(medea.IsKeyDown(16)) {
				ws *= 10;
			}

			// W
			if(medea.IsKeyDown(87)) {
				n.Translate([0,0,-ws * dtime]);
			}
			// A
			if(medea.IsKeyDown(65)) {
				n.Translate([-ws * dtime,0,0]);
			}
			// S
			if(medea.IsKeyDown(83)) {
				n.Translate([0,0,ws * dtime]);
			}
			// D
			if(medea.IsKeyDown(68)) {
				n.Translate([ws * dtime,0,0]);
			}

			// PAGE UP
			if(medea.IsKeyDown(33)) {
				if (this.terrain_entity) {
					this.terrain_entity.HeightOffset(this.terrain_entity.HeightOffset()+ws * dtime);
				}
				else {
					n.Translate([0,ws * dtime,0]);
				}
			}
			
			// PAGE DOWN
			if(medea.IsKeyDown(34)) {
				if (this.terrain_entity) {
					this.terrain_entity.HeightOffset(this.terrain_entity.HeightOffset()-ws * dtime);
				}
				else {
					n.Translate([0,-ws * dtime,0]);
				}
			}
		}
	});
	
	
	medea.OrbitCamController = medea.CamController.extend({
		turn_speed : 0.015,
		camera_distance : 3.0,
		pan_speed : 0.004,
		zoom_speed : 1.00105,
		minimum_camera_distance : 0.1,
		

		init : function(enabled) {
			this._super(enabled);
			
			this.view = mat4.identity(mat4.create()); // TODO: set initial state
			this.view_with_offset = mat4.identity(mat4.create());
			this.pan_vector = [0.0,0.0];
		},


		
		TurnSpeed : medea._GetSet('turn_speed'),
		ZoomSpeed : medea._GetSet('zoom_speed'),
		PanSpeed : medea._GetSet('pan_speed'),
		
		CameraDistance : medea._GetSet('camera_distance'),
		MinimumCameraDistance : medea._GetSet('minimum_camera_distance'),


		ProcessMouseDelta : function(dtime, node, d) {
			
			// process mouse movement on the x axis
			if(d[0]) {
				mat4.rotateY(this.view, d[0]*this.turn_speed);
			}
			
			// process mouse movement on the y axis
			if(d[1]) {
				mat4.rotateX(this.view, d[1]*this.turn_speed);
			}
			
			this._UpdateNodeTransformation(node);
		},
		
		
		ProcessMouseWheel : function(dtime, node, z) {
			var d = this.camera_distance;
			d *= Math.pow(this.zoom_speed, -z * 50);
            d = Math.max(d, this.minimum_camera_distance);
			this.camera_distance = d;

			this._UpdateNodeTransformation(node);
		},
		
		
		Pan : function(x, y, node) {
			var ps = this.pan_speed;
            this.pan_vector[0] += x * ps;
            this.pan_vector[1] += -y * ps;

            this._UpdateNodeTransformation(node);
        },
		
		
		_UpdateNodeTransformation : function(node) {
			var vo = this.view_with_offset;
			var v  = this.view;
			var dist = this.camera_distance;

			mat4.identity(vo);
			
			var veye = [v[2]  * dist, v[6]  * dist, v[10] * dist];
			vo[2]  = v[2];
			vo[6]  = v[6];
			vo[10] = v[10];
			
			var vup = [v[1], v[5], v[9]];
			
			var vright = vec3.cross(vup, veye, vec3.create());
			vec3.normalize(vright);
			vo[0]  = vright[0];
			vo[4]  = vright[1];
			vo[8]  = vright[2];

			vec3.cross(veye, vright, vup);
			vec3.normalize(vup);
			vo[1]  = vup[0];
			vo[5]  = vup[1];
			vo[9]  = vup[2];

			mat4.translate(vo, veye);
			node.LocalTransform(vo);
		}
	});
	
	
	
	medea.RotateXCamController = medea.CamController.extend({
		turn_speed : 0.005,
		

		init : function(enabled) {
			this._super(enabled);
		},
 

		
		TurnSpeed : medea._GetSet('turn_speed'),


		ProcessMouseDelta : function(dtime, n, d) {
			
			// process mouse movement on the x axis
			if(d[0]) {
				var mrot = mat4.rotate(mat4.identity(mat4.create()),d[0]*this.turn_speed,[0,1,0]);
				n.LocalYAxis(mat4.multiplyVec3(mrot,n.LocalYAxis()));
				n.LocalZAxis(mat4.multiplyVec3(mrot,n.LocalZAxis()));
				n.LocalXAxis(vec3.cross(n.LocalYAxis(),n.LocalZAxis()));
			}		
		}
	});
	
	

	/** */
	medea.CreateCamController = function(kind, enabled) {
		kind = kind || 'fps';
		if(kind === 'fps') {
			return new medea.FpsCamController(enabled);
		}
		else if(kind === 'orbit') {
			return new medea.OrbitCamController(enabled);
		}
		else if(kind === 'rotatex') {
			return new medea.RotateXCamController(enabled);
		}
		else {
			medea.DebugAssert("camcontroller mode not recognized: " + kind);
			return null;
		}
	};
});


