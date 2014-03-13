/*


	take incoming input from client, run physics on it, send results


*/

var gameport        = process.env.PORT || 4004,
    io              = require('socket.io'),
    express         = require('express'),
    UUID            = require('node-uuid'),
    verbose         = false,
    http            = require('http'),
    app             = express(),
    server          = http.createServer(app);
	
// Tell the server to listen for incoming connections
server.listen(gameport);

// Log something so we know that it succeeded.
console.log('\t :: Express :: Listening on port ' + gameport );

// By default, we forward the / path to index.html automatically.
app.get( '/', function( req, res ){
	console.log('trying to load %s', __dirname + '/client.html');
	res.sendfile( '/client.html' , { root:__dirname });
});


// This handler will listen for requests on /*, any file from the root of our server.
// See expressjs documentation for more info on routing.

app.get( '/*' , function( req, res, next ) {

	//This is the current file they have requested
	var file = req.params[0];

	//For debugging, we can track what files are requested.
	if(verbose) console.log('\t :: Express :: file requested : ' + file);

	//Send the requesting client the file.
	res.sendfile( __dirname + '/' + file );

}); //app.get *

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

var clients = [];

sio.sockets.on('connection', function(client) {
	
	client.userid = UUID();
	
	clients[client.userid] = { userid: client.userid, speed: 5, position: { x: 0, y :0 }, positions: [], latest_seq: 0, inputs: [], latest_ct: 0 };
	clients[client.userid].position.x = randomInt(-10, 10);
	clients[client.userid].position.y = randomInt(-10, 10);
	
	client.emit('client-connected', { id: client.userid, x: clients[client.userid].position.x, y: clients[client.userid].position.y } );
	console.log('\t socket.io:: player ' + client.userid + ' connected');
	sio.sockets.emit('moved-latest', { id: client.userid, pos: clients[client.userid].position, seq: clients[client.userid].latest_seq, ct: clients[client.userid].latest_ct, st: (new Date().getTime()) });
	
	for (var client_id in clients) {
		if (client_id == client.userid) {
			continue;
		}
		client.emit('moved-latest', { id: client_id, pos: clients[client_id].position, seq: clients[client_id].latest_seq, ct: clients[client_id].latest_ct, st: (new Date().getTime()) });
	}
	
	client.on('moved', function(data) {
		//console.log(client.userid + ' moved:');
		//console.log(data);
		clients[client.userid].inputs.push(data);
	});
	
	client.on('disconnect', function() {
		console.log('\t socket.io:: player ' + client.userid + ' left');
		sio.sockets.emit('player-left', client.userid);
		delete clients[client.userid];
	});
	
});

var lastPhysicsTime = new Date();

setInterval(function() {
	var nowTime = new Date();
	var deltaTime = (nowTime - lastPhysicsTime)/1000; // deltaTime = percentage of one second elapsed between "frames"
	//console.log('physics delta time: ' + deltaTime);
	
	// go through clients' inputs, double-check where they are, send results
	for (var client_id in clients) {
		
		// go through inputs
		if (clients[client_id].inputs.length > 0) {
			
			var new_position_updates = false;
			
			for (var i = 0; i < clients[client_id].inputs.length; i++) {
					
				if (clients[client_id].inputs[i].seq <= clients[client_id].latest_seq) {
					continue;
				}
				
				new_position_updates = true;
				
				var this_input = clients[client_id].inputs[i];
				var x_dir = 0;
				var y_dir = 0;
			
				if (this_input.i.indexOf('u') > -1) { // moved forward
					y_dir += clients[client_id].speed * this_input.dt;
				}
			
				if (this_input.i.indexOf('d') > -1) { // moved backwards
					y_dir -= clients[client_id].speed * this_input.dt;
				}
			
				if (this_input.i.indexOf('l') > -1) { // moved left
					x_dir += clients[client_id].speed * this_input.dt;
				}
			
				if (this_input.i.indexOf('r') > -1) { // moved right
					x_dir -= clients[client_id].speed * this_input.dt;
				}
			
				clients[client_id].position.x += x_dir;
				clients[client_id].position.y += y_dir;
				clients[client_id].position.x = clients[client_id].position.x.toFixed(5) * 1;
				clients[client_id].position.y = clients[client_id].position.y.toFixed(5) * 1;
				
				// see if they've collided with anyone!
				for (var other_client_id in clients) {
					if (client_id == other_client_id) {
						continue;
					}
					if (circleCollision({x: clients[client_id].position.x, y: clients[client_id].position.y, r: 0.5}, {x: clients[other_client_id].position.x, y: clients[other_client_id].position.y, r: 0.5})) {
						// bounce backwards from each other...
						//console.log(client_id + ' and ' + other_client_id + ' collided!');
						clients[client_id].position.x += -x_dir;
						clients[client_id].position.y += -y_dir;
						clients[client_id].position.x = clients[client_id].position.x.toFixed(5) * 1;
						clients[client_id].position.y = clients[client_id].position.y.toFixed(5) * 1;
					}
				}
				
				// see if they've collided with the world!
				// for this usage, stay between 15 and -15 in a square
				if (clients[client_id].position.x > 15) {
					clients[client_id].position.x = 15;
				} else if (clients[client_id].position.x < -15) {
					clients[client_id].position.x = -15;
				}
				if (clients[client_id].position.y > 15) {
					clients[client_id].position.y = 15;
				} else if (clients[client_id].position.y < -15) {
					clients[client_id].position.y = -15;
				}
				
				clients[client_id].positions.push({ seq: this_input.seq, pos: { x: clients[client_id].position.x, y: clients[client_id].position.y }, ct: this_input.ct, st: (new Date().getTime()) });
				clients[client_id].latest_seq = this_input.seq;
				clients[client_id].latest_ct = this_input.ct;
			}
			
			clients[client_id].inputs = []; // we've gone through all of them, so reset
			
			if (new_position_updates) {
				// send what the server thinks should be their position up to the latest sequence number
				var latest_client_info = { id: client_id, pos: clients[client_id].position, seq: clients[client_id].latest_seq, ct: clients[client_id].latest_ct, st: (new Date().getTime()) };
				//console.log(latest_client_info);
				sio.sockets.emit('moved-latest', latest_client_info);
			}
			
		}
	}
	
	
	lastPhysicsTime = new Date();
}, 25); // 100 = 10fps, 20 = 50fps, 15 = 66.667fps

// cleanup loop
var cleanup_position_cut_seconds = 5000; // in milliseconds, of course
setInterval(function() {
	//console.log('cleanup!');
	// go through clients and flush out their server-side position history from over cleanup_position_cut_seconds seconds ago
	var current_time = (new Date().getTime());
	for (var client_id in clients) {
		if (clients[client_id].positions.length > 0) {
			var where_to_cut = 0;
			for (var i = 0; i < clients[client_id].positions.length; i++) {
				if (clients[client_id].positions[i].st < current_time - cleanup_position_cut_seconds) {
					//console.log('position #'+i+' is over 5 seconds old!');
					where_to_cut = i;
				}
			}
			// keep the last known position, if nothing else
			clients[client_id].positions.splice(0, where_to_cut);
		}
		//console.log(clients[client_id].positions);
	}
}, cleanup_position_cut_seconds);



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