var l = console.log;
var spawn = require('child_process').spawn;
var utility = require('rie-utility');
var round = function(flt, places){
	if (places==undefined) places = 5;
	var f = Math.pow(10,places);
	return Math.round( flt * f ) / f;
}


module.exports= function(verb){

	var self = this;

	this.MSPERDAY = 86400000;
	this.now = new Date();
	this.util = new utility({});

	this.is_partial = false;





	this.verb = verb;
	/*
		intitialize 	

	*/
	this._init =  function(req,res,is_api_call){
		self.req = req;
		self.res = res;
		self.mdb = req.app.mdb; //controls
		self.fdb = req.app.fdb; //filebound_prod
		self.cdb = req.app.cdb; //claims
		self.sess = req.session;
		self.is_api_call = is_api_call;
		if ( typeof self.after_init=="function")
			self.after_init();
	}


	this._ok = function(pkg){
		pkg.status = true;
		return self.res.send(pkg);
	}

	this._fail = function(pkg){
		pkg.status = false;
		l(pkg);
		if ( self.is_api_call ){
			self.res.send(pkg);
			return false;
		}

		if ( self.is_partial ){
			self.res.send("Failed loading partial");	
			return false;
		}


		/* this is called by a landing page, so redirect */
		if ( undefined==pkg.to ) pkg.to="login";
		self.res.redirect( "/"+pkg.to );
		return false;
	}


	this._db_error = function(err,pkg){

		l("db error occurred");

		return self._fail({err:err,pkg:pkg,msg:"db error"});
	}

	/*
		checks for required parameter keys
		sends the response if any required 
		parameters are missing	
	*/
	this._rp = function( p, req_params_list ){
		var missing=[];
		for(var k = 0; k < req_params_list.length; k++){
			var param_name = req_params_list[k];
			if ( p[ param_name ] == undefined ){
				missing.push(param_name);
			}
		}

		if (missing.length){
			self._fail({msg:"Missing required parameters", missing: missing});
			return false;
		}

		return true;
	}
	

	this._actioner_is_valid = function(){
		if ( (self.sess.u_id==undefined || self.sess.roles==undefined) && self.req.app.enforce_user )
			return self._fail({msg:"You must be logged in",to:"login"});
		return true;
	}

	this._actioner_requires_role = function(role){
		if ( (self.sess.u_id==undefined || self.sess.roles==undefined) && self.req.app.enforce_user )
			return self._fail({msg:"You must be logged in",to:"login"});

		if ( -1 == self.sess.roles.indexOf(role) ){
			return self._fail({msg:"You are not authorized to do this.",to:"not_auth"});
		}
		return true;
	}


	/*
		map is hash of  session_prop_name : session_property_value(s) it must contain 
	*/
	this._actioner_can_view = function(map){
		if ( self.sess.u_id==undefined || self.sess.roles==undefined )
			return self._fail({msg:"You must be logged in",to:"login"});
			
		var failed_keys = [];

		if ( -1 != self.sess.roles.indexOf("buyer") )
			return true;


		for(var k in map ){
			if ( undefined == self.sess[ k ] ){
				failed_keys.push( k );
			}	
			else{
				if ( -1 == self.sess[ k ].indexOf( map[k] ) )
					failed_keys.push(k);
			}
		}

		if ( failed_keys.length ){
			return self._fail({msg:"You are not authorized to do this.",to:"not_auth", failed_on: failed_keys});
		}

		return true;
	}

	this._actioner_has_role = function(role){ //returns either true or false
		if ( self.sess.u_id==undefined || self.sess.roles==undefined )
			return false;

		if ( -1 == self.sess.roles.indexOf(role) )
			return false

		return true;
	}



	this.test = function(){
		l("BASE.test executed");
	}





	/*
		- login	
		

	*/
	this.login = function(params){
		if ( self.sess.u_id )
			return self._fail({msg:"You're already logged in"});
		
		if ( !self._rp(params, ["u_id","pw"] ) )
			return ;
			
		var opts = {
			criteria: { 
				_id: params.u_id,
				pw: params.pw 
			},
			fields:{
				stats: 0
			}
		};

		self.mdb.find(
			"users",
			opts,
			function(err, rr, cursor_id){
				if (err)
					return self._db_error(err, {opts:opts} );

				if (!rr.length)
					return self._fail({msg:"Invalid userid / password ", rr:rr, opts:opts});
				
				var u = rr[0];
				var pkg = {u_id: u._id,  msg:"Hello " + u._id, orig_params:params, roles: u.roles}
				self.sess.u_id = u._id
				self.sess.roles = u.roles;
				self.sess.save();
				return self._ok(pkg);
			}
		);
	}

	
	/*
		landing
	*/
	this.land = function(req,res){
		self._init(req,res,false);
		res.locals.last_listings = [];
		res.locals.env = req.app.get('env');
		res.locals.util = self.util;
		res.locals.now = new Date();

		//attach global data elements that will be displayed on every landing (navbar)
		//if ( self.sess.u_id==undefined || self.sess.roles==undefined ){
		if ( self.sess.u_id==undefined ){
			res.locals.u_id = false;
		}
		else{ 
			res.locals.u_id = self.sess.u_id;
			res.locals.user = self.sess.user;
			if ( self.is_partial )
				l(self.sess.u_id + " partial " + req.url.toString());
			else
				l(self.sess.u_id + " landed " + req.url.toString());
		}
		self.app_data = req.app.app_data;
		res.locals.app_data = req.app.app_data;
		res.locals.util = self.util;
		//l(res.locals.app_data);
	}


	/*
		partial html block
	*/
	this.partial = function(req,res){
		self.is_partial = true;
		return self.land(req,res);
	}



	/*
		api call router	

	*/
	this.api =  function(req,res){
		self._init(req,res,true);

		var command = req.params.command;
		if (this.verb=="get"){
			var params = req.params.json;
      try {
        params = JSON.parse(params);
      }
      catch(err){
        return self._fail({
          msg:"invalid paramaters - JSON parse failed",orig_params:params
        });
      }
		}
		else{
			var params = req.body;
		}

			

		if ( typeof params !== "object" ){
			return self._fail({msg:"invalid paramaters - JSON parsed into non object",orig_params:params, type_of: (typeof params)});
		}

		if ( command.substr(0,1) == "_"  ){
			return self._fail({msg:"invalid command",orig_command: command});
		}

		var command_parts = command.split(/\./);
		if ( command_parts.length > 1 ){
			if ( undefined == self[ command_parts[0] ] ){
				return self._fail({msg:"invalid command - sub command not found", sub_api: command_parts[0], sub_command: command_parts[1], command: command});
			}
			var API_BASE = self[ command_parts[ 0 ] ];
			command = command_parts[1];
		}
		else var API_BASE = self;

		if ( undefined == API_BASE[ command ] ){
			return self._fail({msg:"invalid command - command not found",orig_command: command});
		}

		if ( command!=="mlogin" && command!=="login" && command!=="register" && req.app.enforce_user ){ 
			/* other than login, all api commands require a valid session */
			if ( self.sess.u_id==undefined )
				return self._fail({msg:"you are not logged in"});
			
		}

		//self.req.session.last_comm =  command;
		return API_BASE[command]( params );	
	}


	this._first_page = function( cursor_id, batch_size, total  ){
		current_page_idx = 0;
		var pgs = ( total / batch_size );
		var flr = Math.floor( pgs );
		var pages = flr;
		if ( (pgs - flr) > 0 ) pages++;

		var paging = {
			batch_size: batch_size,
			cursor_id: cursor_id,
			pages : pages,
			per_page: batch_size,
			total: total,
			this_page_num: current_page_idx+1,
			start: 0,
			current_page_idx: current_page_idx
		};
		if ( total > batch_size ) 
			paging.this_page_len = batch_size;
		else
			paging.this_page_len = total ;
		
		paging.rows_txt  = "1 to " + paging.this_page_len + " of " + total;
		paging.page_txt = "Page 1 of " + paging.pages;
		return paging;
	}
	


	/*
		generic handler for cursor based advancement of listings	
		current_page_idx is 0 based index of times cursor used so far
		0 == trying for page 2
		1 == trying for page 3
		only used for pagination calculations
	*/
	
	this._more = function( db, cursor_id, batch_size, page_idx_being_fetched, cb ){
		var opts = {
			more: true,
			id: cursor_id,	
			batch_size: batch_size
		}
		
		db.find(
			"x", //collection name does not matter, pymongo will be using an existing cursor
			opts,
			function(err, rr, cursor_id, total){
				if ( err )
					return self._fail({ 
						msg: "Error accessing database" , err: err, to:"error"
					});
				var paging = {
					cursor_id: cursor_id,
					pages : Math.floor( total / batch_size ) + 1,
					per_page: batch_size,
					total: total,
					this_page_num: page_idx_being_fetched+1,
					start: (page_idx_being_fetched * batch_size),
					current_page_idx: page_idx_being_fetched
				};
				if ( (paging.this_page_num) < paging.pages )
					paging.this_page_len = opts.batch_size;
				else
					paging.this_page_len = ( total - paging.start );
				paging.end = paging.start + paging.this_page_len;
				paging.rows_txt  = (paging.start+1) + " to " + paging.end + " of " + total;
				paging.page_txt = "Page " + paging.this_page_num + "  of " + paging.pages;
				l("End of _more");
				return cb(null, rr, cursor_id, paging);
			}
		);
	}


	/*
		UTILITY ONLY
	*/

	for(var k in self.util){
		if (typeof self.util[k] == "function")
			self["_"+k] = self.util[k];
	}

	this._str_to_date = function(dtstr){ //yyyy-mm-dd
		var y = parseInt( dtstr.substr(0,4), 10 );
		var m = parseInt( dtstr.substr(5,2), 10 );
		var d = parseInt( dtstr.substr(8,2), 10 );

		if ( isNaN(y) || isNaN(m) || isNaN(d) ) return self._fail({msg:"Bad date",dtstr:dtstr});

		m--;

		return new Date(y,m,d);
	}

	this.name = "this is BASE";

	return this;
}

