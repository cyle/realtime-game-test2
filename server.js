/*


	simple real time game server

	based heavily on: https://github.com/underscorediscovery/realtime-multiplayer-in-html5


*/

var gameport        = process.env.PORT || 4004,
    io              = require('socket.io'),
    express         = require('express'),
    UUID            = require('node-uuid'),
    verbose         = false,
    http            = require('http'),
    app             = express(),
    server          = http.createServer(app);
	
// listen for incoming connections
server.listen(gameport);
console.log('game server is istening on port ' + gameport);

// a request for root returns the game client html file
app.get('/', function(req, res){
	console.log('trying to load %s', __dirname + '/client.html');
	res.sendfile( '/client.html' , { root:__dirname });
});

// give out files as they're requested
// this should probably have a filter for security
app.get('/*' , function(req, res, next) {
	var file = req.params[0];
	if(verbose) console.log('(Express) file requested : ' + file);
	res.sendfile(__dirname + '/' + file);
});

// set up the socket.io service
var sio = io.listen(server);
sio.enable('browser client minification'); // send minified client
sio.enable('browser client etag'); // apply etag caching logic based on version number
sio.enable('browser client gzip'); // gzip the file
sio.configure(function() {
	sio.set('log level', 0);
	sio.set('authorization', function (handshakeData, callback) {
		callback(null, true); // error first callback style
	});
});

// this will store all of the connected clients info, based on the Client class
var clients = [];

/*

	deal with new clients

*/

sio.sockets.on('connection', function(client) {
	
	// assign each client a unique ID
	client.userid = UUID();
	
	console.log('player ' + client.userid + ' connected');
	
	var player = new Client(client.userid); // use the Client class!
	
	// set them to a random position on the map
	player.set_position(randomInt(-10, 10), randomInt(-10, 10));
		
	// add the new player to the list of clients
	clients.push(player);
	
	// let the new player know they've connected, and where they are
	client.emit('client-connected', { id: player.userid, x: player.position.x, y: player.position.y } );
	
	// let everyone know that this player has connected
	sio.sockets.emit('moved-latest', { id: player.userid, pos: player.position, seq: player.latest_seq, ct: player.latest_ct, st: (new Date().getTime()) });
	
	// let the new player know where everyone else is
	for (var i = 0; i < clients.length; i++) {
		if (clients[i].userid == player.userid) {
			continue;
		}
		client.emit('moved-latest', { id: clients[i].userid, pos: clients[i].position, seq: clients[i].latest_seq, ct: clients[i].latest_ct, st: (new Date().getTime()) });
	}
	
	// track when this player tells us they have new inputs
	client.on('new-inputs', function(data) {
		//console.log(client.userid + ' moved:');
		//console.log(data);
		player.inputs.push(data);
	});
	
	// track when this player disconnects, tell everyone else, stop tracking them
	client.on('disconnect', function() {
		console.log('player ' + client.userid + ' disconnected');
		sio.sockets.emit('player-left', client.userid);
		removeClientWithId(client.userid);
	});
	
});

/*

	handle everyones' physics

*/

var lastPhysicsTime = new Date();

setInterval(function() {
	var nowTime = new Date();
	var deltaTime = (nowTime - lastPhysicsTime)/1000; // deltaTime = percentage of one second elapsed between "frames"
	//console.log('physics delta time: ' + deltaTime);
	// go through clients' inputs, double-check where they are, send results
	for (var c = 0; c < clients.length; c++) {
		var were_there_new_inputs = clients[c].process_inputs();
		// only do this if there's actually anything to update
		if (were_there_new_inputs == true) {
			clients[c].send_position_updates();
		}
	}
	// update the timestamp of when we finished processing physics
	lastPhysicsTime = new Date();
}, 100); // 100 = 10fps, 20 = 50fps, 15 = 66.667fps

/*

	cleanup loop

	so we don't keep players' position history forever and ever when we really don't need it

*/

var cleanup_position_cut_seconds = 5000; // in milliseconds, of course
setInterval(function() {
	//console.log('cleanup!');
	// go through clients and flush out their server-side position history from over cleanup_position_cut_seconds seconds ago
	for (var c = 0; c < clients.length; c++) {
		clients[c].clean_up_positions(cleanup_position_cut_seconds);
	}
}, cleanup_position_cut_seconds);

/*

	helper functions

*/

function circleCollision(c1, c2) {
	var dx = c1.x - c2.x;
	var dy = c1.y - c2.y;
	var dist = c1.r + c2.r;
	return ((dx * dx) + (dy * dy) <= (dist * dist));
}

function randomInt(min, max) { // inclusive
	if (max == undefined) { // assume it's between 0 and whatever
		return Math.floor(Math.random() * (min + 1));
	} else {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}
}

function randomFloat(min, max) {
	if (max == undefined) { // assume it's between 0 and whatever
		return Math.random() * min;
	} else {
		return Math.random() * (max - min) + min;
	}
}

function removeClientWithId(uuid) {
	var where_to_cut;
	for (var i = 0; i < clients.length; i++) {
		if (clients[i].userid == uuid) {
			where_to_cut = i;
		}
	}
	if (where_to_cut != undefined) {
		clients.splice(where_to_cut, 1);
	}
}

/*

	classes

*/

// the client
function Client(uuid) {
	this.userid = uuid; // unique ID per client
	this.speed = 5; // the player's movement speed
	this.radius = 0.5; // the size of the player (for collisions)
	this.position = { x: 0, y: 0 }; // the player's position
	this.positions = []; // the player's position history
	this.inputs = []; // inputs sent by the client for the server to process
	this.latest_seq = 0; // how far the server has gotten in processing inputs
	this.latest_ct = 0; // what the latest server-processed timestamp from the client is
}

// set client's position
Client.prototype.set_position = function(x, y) {
	this.position.x = x;
	this.position.y = y;
}

// process the client's latest input
Client.prototype.process_inputs = function() {
	
	// are there even any inputs to process?
	if (this.inputs.length == 0) {
		return false; // nope!
	}
	
	var we_did_move = false;
	
	// go through all of the pending inputs from the client
	for (var i = 0; i < this.inputs.length; i++) {
		
		// only check new inputs
		if (this.inputs[i].seq <= this.latest_seq) {
			continue;
		}
		
		var this_input = this.inputs[i];
		
		// this'll be the resulting vector
		var x_dir = 0;
		var y_dir = 0;
	
		// moved forward
		if (this_input.i.indexOf('u') > -1) {
			y_dir += this.speed * this_input.dt;
		}
	
		// moved backwards
		if (this_input.i.indexOf('d') > -1) {
			y_dir -= this.speed * this_input.dt;
		}
		
		// moved left
		if (this_input.i.indexOf('l') > -1) { 
			x_dir += this.speed * this_input.dt;
		}
		
		// moved right
		if (this_input.i.indexOf('r') > -1) { 
			x_dir -= this.speed * this_input.dt;
		}
		
		// moved?
		if (x_dir != 0 || y_dir != 0) {
			
			// oh, we did move! great
			we_did_move = true;
			
			// update current position using resulting vector
			this.position.x += x_dir;
			this.position.y += y_dir;
		
			// keep the position to a certain precision
			this.position.x = this.position.x.toFixed(5) * 1;
			this.position.y = this.position.y.toFixed(5) * 1;
			
			// check for collisions, since we moved
			var collided = this.check_collisions();
			
			if (collided) {
				// move us back
				this.position.x -= x_dir;
				this.position.y -= y_dir;
				// keep the position to a certain precision
				this.position.x = this.position.x.toFixed(5) * 1;
				this.position.y = this.position.y.toFixed(5) * 1;
			}
			
			// update our position history accordingly
			this.update_position(this_input.seq, this_input.ct);
		}
		
	}
	
	// clear out current inputs, since we've handled them all
	this.clear_inputs();
	
	// return whether we did, in fact, end up moving
	return we_did_move;
}

// check collisions between clients
Client.prototype.check_collisions = function() {
	// see if we've collided with anyone!
	
	var collided = false;
	
	// go through all of the other clients
	for (var oc = 0; oc < clients.length; oc++) {
		// skip over yourself, of course
		if (this.userid == clients[oc].userid) {
			continue;
		}
		// use basic circle collision
		if (circleCollision({x: this.position.x, y: this.position.y, r: this.radius}, {x: clients[oc].position.x, y: clients[oc].position.y, r: clients[oc].radius})) {
			//console.log(this.userid + ' and ' + clients[oc].userid + ' collided!');
			collided = true;
		}
	}
	
	// see if we've collided with the world edges
	// for this usage, stay between 15 and -15 in a square
	if (this.position.x > 15) {
		collided = true;
	} else if (this.position.x < -15) {
		collided = true;
	}
	
	if (this.position.y > 15) {
		collided = true;
	} else if (this.position.y < -15) {
		collided = true;
	}
	
	return collided;
}

// update current position info and history
Client.prototype.update_position = function(the_input_seq, the_input_ct) {
	// add this position update to the clients' list of past position updates
	this.positions.push({ seq: the_input_seq, pos: { x: this.position.x, y: this.position.y }, ct: the_input_ct, st: (new Date().getTime()) });
	// update what the latest processed input sequence ID is
	this.latest_seq = the_input_seq;
	// update the latest client time provided by the player
	this.latest_ct = the_input_ct;
}

// send out position updates about this client
Client.prototype.send_position_updates = function() {
	// send to everyone what the server thinks should be this player's position up to the latest sequence number
	var latest_client_info = { id: this.userid, pos: this.position, seq: this.latest_seq, ct: this.latest_ct, st: (new Date().getTime()) };
	sio.sockets.emit('moved-latest', latest_client_info);
}

// clear out any inputs in this client's buffer
Client.prototype.clear_inputs = function() {
	this.inputs = [];
}

// delete old position history from before [milliseconds] ago
Client.prototype.clean_up_positions = function(milliseconds) {
	if (this.positions.length > 0) {
		var current_time = (new Date().getTime());
		var where_to_cut = 0;
		for (var i = 0; i < this.positions.length; i++) {
			if (this.positions[i].st < current_time - milliseconds) {
				where_to_cut = i;
			}
		}
		// keep the last known position, if nothing else
		this.positions.splice(0, where_to_cut);
	}
}
