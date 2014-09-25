// http://www.html5canvastutorials.com/
// http://diveintohtml5.info/canvas.html
// https://hacks.mozilla.org/2012/02/saving-images-and-files-in-localstorage/

// LIBS
var csp = require("js-csp");
var start = csp.go;


// DOM Elements
var canvas = document.getElementById("canvas");
var resetButton = document.getElementById("reset");
var storeButton = document.getElementById("store");
var openButton = document.getElementById("open");
var colorPicker = document.getElementById("colorPicker");

// STATE
var currentColor = "#62a2fc";
var ctx = canvas.getContext('2d');


// PRODUCER CHANNELS
var channelResetButton = createChannel(resetButton, "click");
var channelStoreButton = createChannel(storeButton, "click");
var channelOpenButton = createChannel(openButton, "click");
var channelColorPicker = createChannel(colorPicker, "input");
var channelCanvas = createChannel(canvas, "click");



// CONSUMER CHANNELS


start(function*() {
  while (true) {
    var event = yield csp.take(channelResetButton);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

start(function*() {
  while (true) {
    var event = yield csp.take(channelStoreButton);
    console.log(event);
  }
});

start(function*() {
  while (true) {
    var event = yield csp.take(channelOpenButton);
    console.log(event);
  }
});


start(function*() {
  while (true) {
    var event = yield csp.take(channelColorPicker);
    event.srcElement ? currentColor = event.srcElement.value : currentColor = event.target.value
  }
});


function *canvasClickHandler() {
  var counter = 1;
  var points = [];
  while (true) {
    var event = yield csp.take(channelCanvas);
    
    if (counter < 3) { 
      points.push(getCoordinates(event)); 
      counter++;
    } else {
      points.push(getCoordinates(event)); 
      drawTriangle(points, currentColor);
      counter = 1;
      points = [];
    }
  }
}
start(canvasClickHandler);
    


function getCoordinates(e) {
  var x;
  var y;
  if (e.pageX != undefined && e.pageY != undefined) {
    return {
	    x: e.pageX - canvas.offsetLeft - 1,
	    y: e.pageY - canvas.offsetTop - 1
    }
  } else {
    return {
	    x: e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft - canvas.offsetLeft - 1,
	    y: e.clientY + document.body.scrollTop + document.documentElement.scrollTop - canvas.offsetTop - 1
    }
  }
}

function drawTriangle(points, color) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineTo(points[2].x, points[2].y);
  ctx.fillStyle = color;
  ctx.fill();
}


function noOp() {};

function createChannel(element, eventName) {
  var ch = csp.chan(csp.buffers.dropping(1));
  element.addEventListener(eventName, function(event) {
    csp.putAsync(ch, event, noOp);
  });
  return ch;
}
   