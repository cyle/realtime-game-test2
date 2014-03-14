
// the canvas element is where the magic happens
var canvas = document.getElementById("viewport");

// a place for debug text
var debug_text = document.getElementById("debug");

var other_clients = {};
var client_userid = '';

var engine = new BABYLON.Engine(canvas, true); // load the BABYLON engine
var scene = new BABYLON.Scene(engine); // load the BABYLON scene, where all meshes will live
var camera = new BABYLON.ArcRotateCamera("Camera", Math.PI/2, Math.PI/2, 35, new BABYLON.Vector3(0, 0, 0), scene);
// constrain the camera
camera.lowerRadiusLimit = 10;
camera.upperRadiusLimit = 75;
camera.lowerAlphaLimit = Math.PI * 0.33;
camera.upperAlphaLimit = Math.PI * 0.66;
camera.lowerBetaLimit = Math.PI * 0.33;
camera.upperBetaLimit = Math.PI * 0.66;
	
var light0 = new BABYLON.PointLight("Omni", new BABYLON.Vector3(0, 0, 10), scene);

var bg_plane = new BABYLON.Mesh.CreatePlane("bg", 30, scene);
bg_plane.position = new BABYLON.Vector3(0, 0, 0);
bg_plane.rotation.y = -Math.PI;
bg_plane.material = new BABYLON.StandardMaterial("bg-material", scene);
bg_plane.material.diffuseTexture = new BABYLON.Texture("assets/bg/stars.jpg", scene);

var player_origin = BABYLON.Mesh.CreateSphere("origin", 5, 1.0, scene);
player_origin.material = new BABYLON.StandardMaterial("player-texture", scene);
player_origin.material.diffuseColor = new BABYLON.Color3(0, 1, 0);;
var server_origin = BABYLON.Mesh.CreateSphere("server", 5, 1.0, scene);
server_origin.position = new BABYLON.Vector3(0, 0, 0);
server_origin.material = new BABYLON.StandardMaterial("server-texture", scene);
server_origin.material.wireframe = true;

scene.activeCamera.attachControl(canvas);

var socket = io.connect();

socket.on('client-connected', function(data) {
	console.log(data);
	client_userid = data.id;
	player_origin.position = new BABYLON.Vector3(data.x, data.y, 0);
	server_origin.position = new BABYLON.Vector3(data.x, data.y, 0);
});

socket.on('player-left', function(other_client_id) {
	other_clients[other_client_id].ball.dispose();
	delete other_clients[other_client_id];
});

// register game loop
scene.registerBeforeRender(theGameLoop);

var moveForward = false;
var moveReverse = false;
var rotateLeft = false;
var rotateRight = false;

// listen for keys going down, register them as player movement or whatever
// event.keyCode reference: http://www.cambiaresearch.com/articles/15/javascript-char-codes-key-codes
window.addEventListener('keydown', function(e) {
	switch (e.keyCode) {
		case 87: // w
		moveForward = true;
		break;
		case 65: // a
		rotateLeft = true;
		break;
		case 68: // d
		rotateRight = true;
		break;
		case 83: // s
		moveReverse = true;
		break;
		default:
		//console.log('key pressed: ' + e.keyCode);
	}
});

// register keys coming back up, register them as stopping movement, or whatever
window.addEventListener('keyup', function(e) {
	switch (e.keyCode) {
		case 87: // w
		moveForward = false;
		break;
		case 65: // a
		rotateLeft = false;
		break;
		case 68: // d
		rotateRight = false;
		break;
		case 83: // s
		moveReverse = false;
		break;
		case 67: // c
		// this resets the camera to the "center"
		camera.alpha = Math.PI / 2;
		camera.beta = Math.PI / 2;
		break;
		default:
		//console.log('key released: ' + e.keyCode);
	}
});

var current_time = 0; // current millisecond timestamp
var current_tick_ms = 0; // current tick (delta) time in milliseconds
var deltaTime = 0; // current tick (delta) time in seconds
var speed = 5;

var client_last_position;
var positions = [];
var input_seq = 0;
var server_latest_seq = 0;

// this is the pre-render update() loop
function theGameLoop() {
	
	current_time = new Date().getTime();
	current_tick_ms = BABYLON.Tools.GetDeltaTime();
	deltaTime = current_tick_ms/1000; // divide by 1000 to get per second
	if (deltaTime > 0.25) { // this makes deltaTime stick to above 4fps
		deltaTime = 0.25;
	} else if (deltaTime < 0.01) { // this makes deltaTime stick to below 100fps
		deltaTime = 0.01;
	}
	
	var moved = false;
	var input_this_time = [];
	
	var x_dir = 0;
	var y_dir = 0;
	
	if (moveForward && !moveReverse) {
		input_this_time.push('u');
		y_dir += speed * deltaTime;
		moved = true;
	}
	
	if (!moveForward && moveReverse) {
		input_this_time.push('d');
		y_dir -= speed * deltaTime;
		moved = true;
	}
	
	if (rotateLeft && !rotateRight) {
		input_this_time.push('l');
		x_dir += speed * deltaTime;
		moved = true;
	}
	
	if (!rotateLeft && rotateRight) {
		input_this_time.push('r');
		x_dir -= speed * deltaTime;
		moved = true;
	}
	
	if (moved) {
		
		//console.log('doing physics for you');
		
		// this is for client-side prediction
		player_origin.position.x += x_dir;
		player_origin.position.y += y_dir;
		player_origin.position.x = player_origin.position.x.toFixed(5) * 1;
		player_origin.position.y = player_origin.position.y.toFixed(5) * 1;
		
		// see if we've collided with anyone!
		if (Object.keys(other_clients).length > 0) {
			for (var other_id in other_clients) {
				if (other_clients[other_id].ball == undefined) {
					continue;
				}
				if (circleCollision({x: player_origin.position.x, y: player_origin.position.y, r: 0.5}, {x: other_clients[other_id].ball.position.x, y: other_clients[other_id].ball.position.y, r: 0.5})) {
					// bounce backwards from each other...
					//console.log(client_id + ' and ' + other_client_id + ' collided!');
					player_origin.position.x += -x_dir;
					player_origin.position.y += -y_dir;
					player_origin.position.x = player_origin.position.x.toFixed(5) * 1;
					player_origin.position.y = player_origin.position.y.toFixed(5) * 1;
				}
			}
		}
		
		// see if we've collided with the world!
		// for this usage, stay between 15 and -15 in a square
		if (player_origin.position.x > 15) {
			player_origin.position.x = 15;
		} else if (player_origin.position.x < -15) {
			player_origin.position.x = -15;
		}
		if (player_origin.position.y > 15) {
			player_origin.position.y = 15;
		} else if (player_origin.position.y < -15) {
			player_origin.position.y = -15;
		}
		
		client_last_position = { x: player_origin.position.x, y: player_origin.position.y };
		//console.log('new position: ');
		//console.log({ seq: input_seq, pos: client_last_position });
		positions.push( { seq: input_seq, pos: client_last_position, ct: current_time } );
		
		// send these inputs to the server to see what it does
		var latest_inputs = { i: input_this_time, seq: input_seq, dt: deltaTime, ct: current_time };
		socket.emit('new-inputs', latest_inputs);
		input_seq++;
	}
	
	// go through and show other clients
	if (Object.keys(other_clients).length > 0) {
		//console.log('doing physics for other players');
		
		// turn back time
		current_time -= 100;
		
		for (var other_id in other_clients) {
			
			if (other_clients[other_id].ball == undefined) {
				other_clients[other_id].ball = BABYLON.Mesh.CreateSphere("player-"+other_clients[other_id].id, 5, 1.0, scene);
				other_clients[other_id].ball.material = new BABYLON.StandardMaterial("other-player-texture", scene);
				other_clients[other_id].ball.material.diffuseColor = new BABYLON.Color3(1, 0, 0);
				other_clients[other_id].ball.position.x = other_clients[other_id].positions[0].pos.x;
				other_clients[other_id].ball.position.y = other_clients[other_id].positions[0].pos.y;
			}
			
			var pos_length = other_clients[other_id].positions.length;
			
			if (pos_length == 0) {
				continue;
			}
			
			// old way -- just move them to the latest position
			// other_clients[other_id].ball.position.x = other_clients[other_id].positions[pos_length-1].pos.x;
			// other_clients[other_id].ball.position.y = other_clients[other_id].positions[pos_length-1].pos.y;
			
			// new way -- we need to move them between two old position updates
			// find those updates and lerp between them based on where the clients' current time is between them
			var prev_pos;
			var next_pos;
			for (var i = 0; i < pos_length - 1; i++) {
				if (current_time > other_clients[other_id].positions[i].ct && current_time < other_clients[other_id].positions[i+1].ct) {
					prev_pos = other_clients[other_id].positions[i];
					next_pos = other_clients[other_id].positions[i+1];
					break;
				}
			}
			
			if (prev_pos == undefined && next_pos == undefined) {
				// move them the old fashioned way... snap to latest
				//other_clients[other_id].ball.position.x = other_clients[other_id].positions[pos_length-1].pos.x;
				//other_clients[other_id].ball.position.y = other_clients[other_id].positions[pos_length-1].pos.y;
				other_clients[other_id].ball.position.x = other_clients[other_id].position.x;
				other_clients[other_id].ball.position.y = other_clients[other_id].position.y;
			} else {
				// lerp between positions
				// how far are we between current time and the previous time?
				// what's the spatial distance between the previous position and the next one?
				// move the other player 
				var time_percentage = (current_time - prev_pos.ct) / (next_pos.ct - prev_pos.ct);
				var x_distance = next_pos.pos.x - prev_pos.pos.x;
				var y_distance = next_pos.pos.y - prev_pos.pos.y;
				// lerp = (start + percent*(end - start));
				other_clients[other_id].ball.position.x = prev_pos.pos.x + (x_distance * time_percentage);
				other_clients[other_id].ball.position.y = prev_pos.pos.y + (y_distance * time_percentage);				
			}
			
			// always do this
			other_clients[other_id].ball.position.x = other_clients[other_id].ball.position.x.toFixed(5) * 1;
			other_clients[other_id].ball.position.y = other_clients[other_id].ball.position.y.toFixed(5) * 1;
			other_clients[other_id].position.x = other_clients[other_id].ball.position.x;
			other_clients[other_id].position.y = other_clients[other_id].ball.position.y;
		}
	}
	
}

socket.on('moved-latest', function(data) {
	// the server is telling us where it thinks someone should be
	if (data.id == client_userid) {
		// show where the server thinks we should be
		server_origin.position.x = data.pos.x;
		server_origin.position.y = data.pos.y;
		// confirm that the latest position the server has matches with ours
		for (var i = 0; i < positions.length; i++) {
			if (positions[i].seq == data.seq) {
				if (positions[i].pos.x == data.pos.x && positions[i].pos.y == data.pos.y) {
					//console.log('server says we are cool where we were');
				} else {
					//console.log('ERROR! we are not where we are supposed to have been!');
					player_origin.position.x = data.pos.x;
					player_origin.position.y = data.pos.y;
				}
			}
		}
	} else {
		// another player!
		//console.log("message from server with another player's latest movement");
		if (other_clients[data.id] == undefined) {
			other_clients[data.id] = {};
			other_clients[data.id].id = data.id;
			other_clients[data.id].position = data.pos;
			other_clients[data.id].positions = [];
			other_clients[data.id].ct = (new Date().getTime());
		}
		other_clients[data.id].positions.push({ct: (new Date().getTime()), pos: data.pos});
	}
});

engine.runRenderLoop(function() {
	scene.render(); // render it!
});

// handle window resize
window.addEventListener("resize", function() {
	engine.resize(); // resize the engine accordingly
});

// cleanup loop
var cleanup_position_cut_seconds = 5000; // in milliseconds, of course
setInterval(function() {
	//console.log('cleanup!');
	var current_time = (new Date().getTime());
	var where_to_cut = 0;
	// go through and flush this client's position history from over cleanup_position_cut_seconds seconds ago
	if (positions.length > 0) {
		for (var i = 0; i < positions.length; i++) {
			if (positions[i].ct < current_time - cleanup_position_cut_seconds) {
				where_to_cut = i;
			}
		}
		// keep the last known position, if nothing else
		positions.splice(0, where_to_cut);
	}
	// trim other clients' position counts
	if (Object.keys(other_clients).length > 0) {
		for (var other_id in other_clients) {
			where_to_cut = 0; // reset this for each client
			if (other_clients[other_id].positions.length > 0) {
				for (var i = 0; i < other_clients[other_id].positions.length; i++) {
					if (other_clients[other_id].positions[i].ct < current_time - cleanup_position_cut_seconds) {
						where_to_cut = i;
					}
				}
				// keep the last known position, if nothing else
				other_clients[other_id].positions.splice(0, where_to_cut);
			}
		}
	}
}, cleanup_position_cut_seconds);

// debug loop
setInterval(function() {
	// show stuff in debug info field
	debug_text.innerHTML = '';
	debug_text.innerHTML += '<p>fps: ' + BABYLON.Tools.GetFps().toPrecision(3) + '</p>';
	debug_text.innerHTML += '<p>your pos: x: ' + player_origin.position.x + ', y: ' + player_origin.position.y + '</p>';
	if (Object.keys(other_clients).length > 0) {
		for (var other_id in other_clients) {
			if (other_clients[other_id].ball == undefined) {
				continue;
			}
			debug_text.innerHTML += '<p>other player pos: x: ' + other_clients[other_id].ball.position.x + ', y: ' + other_clients[other_id].ball.position.y + '</p>';
		}
	}
}, 100);

function circleCollision(c1, c2) {
	var dx = c1.x - c2.x;
	var dy = c1.y - c2.y;
	var dist = c1.r + c2.r;
	return ((dx * dx) + (dy * dy) <= (dist * dist));
}