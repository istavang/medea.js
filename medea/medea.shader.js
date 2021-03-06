
/* medea.js - Open Source, High-Performance 3D Engine based on WebGL.
 *
 * (c) 2011-2013, Alexander C. Gessler
 *  https://github.com/acgessler/medea.js
 *
 * Made available under the terms and conditions of a 3-clause BSD license.
 *
 */

medealib.define('shader',['filesystem','cpp.js'],function(medealib, undefined) {
	"use strict";
	var medea = this, gl = medea.gl;

	var stddev_ext = gl.getExtension("OES_standard_derivatives");
	
	// #ifdef DEBUG
	if (stddev_ext) {
		medealib.LogDebug('using OES_standard_derivatives extension');
	}
	else {
		medealib.LogDebug('OES_standard_derivatives extension not available');
	}
	// #endif

	medea.SHADER_TYPE_PIXEL = gl.FRAGMENT_SHADER;
	medea.SHADER_TYPE_VERTEX = gl.VERTEX_SHADER;

	

	// counter for getting shader ids from
	var shader_id_counter = 0;

	// cache for compiled shader objects
	var sh_cache = {
	};

	// cache for shader source code
	var sh_source_cache = {
	};

	var sh_source_waiters = {
	};

	// predefined macros
	var default_defines = {
		'GL_ES' : ''
	};

	var re_toplevel = /^\s*toplevel\(\s*"\s*(.+)\s*"\s*\)\s*$/;

	medea.Shader = medea.Resource.extend( {

		type : null,
		shader : null,
		source_cache_name : null,

		init : function(src, defines, callback, from_source, type, cache_key) {
			this.type = type || src.split('.').pop() == 'ps'
				? medea.SHADER_TYPE_PIXEL
				: medea.SHADER_TYPE_VERTEX;

			this.shader = 0;
			this.defines = medealib.Merge(defines || {},default_defines);

			this.source_cache_name = from_source && !cache_key ? null :
				(from_source ? cache_key : src);

			// if the shader source is given without an explicit cache key, disable caching.
			var	self = this
			,	source_cache_name = this.source_cache_name
			,	cached_source = !source_cache_name ? null : sh_source_cache[source_cache_name]
			,	complete
			;

			if(cached_source) {
				this._super(src, callback, true);

				complete = function() {
					self.OnDelayedInit(sh_source_cache[self.src]);
				};

				if(Array.isArray(cached_source)) {
					cached_source.push(complete);
				}
				else {
					complete();
				}
				return;
			}

			if(this.source_cache_name) {
				sh_source_cache[this.source_cache_name] = [];
			}

			if(from_source) {	
				this.OnDelayedInit(src);
				this._super('<shader source>', callback, true);
				return;
			}

			// trigger deferred loading
			this._super(src, callback);
		},


		OnDelayedInit : function(data) {
// #ifdef DEBUG
			medealib.DebugAssert(typeof data === "string","got unexpected argument, perhaps "
				+ "the source for the shader was not a single resource?"
			);
// #endif
			this.source = data;

			if(this.source_cache_name) {
				// update cache entry, inform anyone waiting
				var source_cache_entry = sh_source_cache[this.source_cache_name];
				sh_source_cache[this.source_cache_name] = data;
				if(Array.isArray(source_cache_entry)) {
					source_cache_entry.forEach(function(e) {
						e();
					});
				}
			}

			// _super() is dynamically assigned and ceases to exist as soon
			// as OnDelayedInit returns, so we need to grab a ref.
			var self = this;
			var call_outer_super = self._super;
	
			// check if the shader has already been loaded or is currently
			// being fetched/compiled.
			var c = this._GetCacheName();
			var s = sh_cache[c];
			if(s !== undefined) {
				var commit = function(s) {
					self.gen_source = s.gen_source;
					self.shader = s.shader;
					self.shader_id = s.shader_id;
					call_outer_super.apply(self);
				};
				if(Array.isArray(s)) {
					// loading is in process, wait for it.
					s.push(commit);
				}
				else {
					commit(s);
				}
				return;
			}

			var waiters = sh_cache[c] = [];

			// additional top-level declarations are specified in-place using
			// #pragma toplevel. Each time cpp.js encounters one, it invokes
			// settings.pragma_func.
			var top_level_decls = [];

			// preprocessing shaders is asynchronous
			var settings = {
				// Required so #extension is preserved for the GLSL parser to handle
				keep_unknown_preprocessor_statements : true,
				include_func : function(file, is_global, resumer) {
					if (!is_global) {
						file = medea._GetPath(self.src) + file;
					}

					medea.Fetch(file,
						function(data) {
							resumer(data);
						},
						function(error) {
							resumer(null);
						}
					);
				},

				completion_func : function(data) {
					// #ifdef DEBUG
					medealib.DebugAssert(!!data,'unexpected null');
					// #endif

					var arr = [];
					for(var e in top_level_decls) {
						arr.push(e);
					}

					self.gen_source = arr.join('\n') + '\n' + data;
					s = self.shader = gl.createShader(self.type);

					self.shader_id = ++shader_id_counter;

					// create a new cache entry for this shader
					var entry = sh_cache[c] = {
						shader : self.shader,
						source : self.source,
						gen_source : self.gen_source,
						shader_id : self.shader_id
					};

					// compile the preprocessed shader
					gl.shaderSource(s,self.gen_source);
					gl.compileShader(s);

					if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
						medealib.NotifyFatal("failure compiling shader " +  self.src
							+ ", error log: " + gl.getShaderInfoLog(s)
						);
						return;
					}

					// mark this resource as complete
					call_outer_super.apply(self);

					// callback all waiters
					for (var i = 0, e = waiters.length; i < e; ++i) {
						waiters[i](entry);
					}

					medealib.LogDebug("successfully compiled shader "
						+ self.src
					);
				},

				error_func : function(message) {
					medealib.NotifyFatal("failure preprocessing shader "
						+ ": " + message
					);
					return;
				},

				pragma_func : function(pragma_text) {
					var r = re_toplevel.exec(pragma_text);
					if (!r) {
						medealib.NotifyFatal("syntax error in #pragma toplevel: " + pragma_text);
						return null;
					}

					top_level_decls[r[1]] = 1;
					return true;
				}
			};

			var cpp = cpp_js(settings);
			cpp.define_multiple(this.defines);
			cpp.run(data, this.src);

			// do _not_ mark the resource as complete yet. This is done
			// in the completion_func above, which is invoked by cpp.js.
		},

		GetSourceCode : function() {
			return this.source;
		},

		GetPreProcessedSourceCode : function() {
			return this.gen_source;
		},

		GetGlShader : function() {
			return this.shader;
		},

		GetShaderId : function() {
			return this.shader_id;
		},

		_GetCacheName : function() {
			var o = this.src;

			if (this.defines) {
				var d = this.defines;
				o += '#';
				for(var k in d) {
					o += k+'='+(d[k] || '');
				}
			}
			return o;
		}
	});

	medea.CreateShader = function(res, defines, callback) {
		return new medea.Shader(res, defines, callback);
	};

	medea.CreateShaderFromSource = function(type, source, defines, callback, cache_key) {
		return new medea.Shader(source, defines, callback, true, type, cache_key);
	};
});
