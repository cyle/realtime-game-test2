# trying this again

this is a prototype of a "properly made" network mutliplayer game in HTML5/Javascript/Node.js, using the [Babylon.js 3D engine](https://github.com/BabylonJS/Babylon.js) on the client-side, and [socket.io](http://socket.io/) on the server-side. 

## usage

requires node 0.10.x

on a mac, open up Terminal, clone the repo somewhere, go into it, then:

`npm install express socket.io node-uuid`

and then run `node server.js` and go to http://localhost:4004/ to interact with it

## features

- move around your floating ball (green) with WASD
- watch other players' move around their floating balls (red)
- collision with other players
- see where the server currently tracks your position as (wireframe ball)
- movement is frame rate independent
- client-side physics prediction for smoothness
- client-side physics interpolation/prediction of other players' movements for smoothness
- server tracks everyones' physics 10 times per second
- server broadcasts updates about other players' movements 10 times per second max

## to do

- refactor into object prototypes instead of a big mess of code

## credit

this project is heavily based on [underscorediscovery/realtime-multiplayer-in-html5](https://github.com/underscorediscovery/realtime-multiplayer-in-html5), including the blog post about it [here](http://buildnewgames.com/real-time-multiplayer/) and further reading [here](http://www.gabrielgambetta.com/fast_paced_multiplayer.html).