
// the canvas element is where the magic happens
var canvas = document.getElementById("viewport");

var other_clients = {};
var client_userid = '';

var socket = io.connect();

socket.on('client-connected', function(data) {
	console.log(data);
	client_userid = data.id;
});


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

var player_origin = BABYLON.Mesh.CreateSphere("origin", 5, 1.0, scene);
var server_origin = BABYLON.Mesh.CreateSphere("server", 5, 1.0, scene);
server_origin.position = new BABYLON.Vector3(-2, 0, 0);
server_origin.material = new BABYLON.StandardMaterial("texture1", scene);
server_origin.material.wireframe = true;

scene.activeCamera.attachControl(canvas);

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
		default:
		//console.log('key released: ' + e.keyCode);
	}
});

var deltaTime = 0;
var speed = 5;

var client_last_position;
var positions = [];
var input_seq = 0;
var server_latest_seq = 0;

// this is the pre-render update() loop
function theGameLoop() {
	
	deltaTime = BABYLON.Tools.GetDeltaTime()/1000; // divide by 1000 to get per second
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
		// this is for client-side prediction
		player_origin.position.x += x_dir;
		player_origin.position.y += y_dir;
		player_origin.position.x = player_origin.position.x.toFixed(5) * 1;
		player_origin.position.y = player_origin.position.y.toFixed(5) * 1;
		client_last_position = { x: player_origin.position.x, y: player_origin.position.y };
		//console.log('new position: ');
		//console.log({ seq: input_seq, pos: client_last_position });
		var current_time = (new Date().getTime());
		positions.push( { seq: input_seq, pos: client_last_position, ct: current_time } );
		
		// send these inputs to the server to see what it does
		var latest_inputs = { i: input_this_time, seq: input_seq, dt: deltaTime, ct: current_time };
		socket.emit('moved', latest_inputs);
		input_seq++;
	}
	
	// go through and show other clients
	if (Object.keys(other_clients).length > 0) {
		console.log('showing other clients!');
		for (var other_id in other_clients) {
			if (other_clients[other_id].ball == undefined) {
				other_clients[other_id].ball = BABYLON.Mesh.CreateSphere("player-"+other_clients[other_id].id, 5, 1.0, scene);
				other_clients[other_id].ball.material = new BABYLON.StandardMaterial("player-texture", scene);
				other_clients[other_id].ball.material.diffuseColor = new BABYLON.Color3(1, 0, 0);;
			}
			other_clients[other_id].ball.position.x = other_clients[other_id].pos.x;
			other_clients[other_id].ball.position.y = other_clients[other_id].pos.y;
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
					console.log('ERROR! we are not where we are supposed to have been!');
					player_origin.position.x = data.pos.x;
					player_origin.position.y = data.pos.y;
				}
			}
		}
	} else {
		// another player!
		console.log('another player moved!');
		//console.log(data.id);
		if (other_clients[data.id] == undefined) {
			other_clients[data.id] = {};
		}
		other_clients[data.id].seq = data.seq;
		other_clients[data.id].pos = data.pos;
		other_clients[data.id].id = data.id;
		//console.log(other_clients[data.id]);
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
	console.log('cleanup!');
	// go through and flush this client's position history from over cleanup_position_cut_seconds seconds ago
	if (positions.length > 0) {
		var where_to_cut = 0;
		var current_time = (new Date().getTime());
		for (var i = 0; i < positions.length; i++) {
			if (positions[i].ct < current_time - cleanup_position_cut_seconds) {
				//console.log('position #'+i+' is over 5 seconds old!');
				where_to_cut = i;
			}
		}
		// keep the last known position, if nothing else
		positions.splice(0, where_to_cut);
	}
}, cleanup_position_cut_seconds);