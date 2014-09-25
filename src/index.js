// http://www.html5canvastutorials.com/
// http://diveintohtml5.info/canvas.html
// https://hacks.mozilla.org/2012/02/saving-images-and-files-in-localstorage/
// http://jsfiddle.net/RZZ6X/

// LIBS
var csp = require("js-csp");
var start = csp.go;
var storage = require("./storage");
var producers = require("./producers");

// DOM Elements
// var canvas = document.getElementById("canvas");
// var resetButton = document.getElementById("reset");
// var storeButton = document.getElementById("store");
// var openButton = document.getElementById("open");
// var colorPicker = document.getElementById("colorPicker");
// var selectFile = document.getElementById("selectFile");


// STATE
var currentColor = "#62a2fc";
var ctx = canvas.getContext('2d');
var fileNameToSave = document.getElementById("fname");
var fileNameToOpen = ""


// PRODUCER CHANNELS
// var channelResetButton = createChannel(resetButton, "click");
// var channelStoreButton = createChannel(storeButton, "click");
// var channelOpenButton = createChannel(openButton, "click");
// var channelColorPicker = createChannel(colorPicker, "input");
// var channelCanvas = createChannel(canvas, "click");
// var channelSelectFile = createChannel(selectFile, "change");


// CONSUMER CHANNELS

start(function*() {
  while (true) {
    var event = yield csp.take(producers.channelSelectFile);
    console.log(event.target.value);
    event.srcElement ? fileNameToOpen = event.srcElement.value : fileNameToOpen = event.target.value;
  }
});


start(function*() {
  while (true) {
    var event = yield csp.take(producers.channelResetButton);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

start(function*() {
  while (true) {
    var event = yield csp.take(producers.channelStoreButton);
    storage.save(fileNameToSave.innerHTML, canvas.toDataURL());
    fileNameToSave.innerHTML = "";
  }
});

start(function*() {
  while (true) {
    var event = yield csp.take(producers.channelOpenButton);
    var img = new Image;
    img.src = storage.find(fileNameToOpen);
    img.onload = function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);      
      ctx.drawImage(img, 0, 0)
    }        
  }
});


start(function*() {
  while (true) {
    var event = yield csp.take(producers.channelColorPicker);
    event.srcElement ? currentColor = event.srcElement.value : currentColor = event.target.value
  }
});


function *canvasClickHandler() {
  var counter = 1;
  var points = [];
  while (true) {
    var event = yield csp.take(producers.channelCanvas);
    
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


// function noOp() {};
// 
// function createChannel(element, eventName) {
//   var ch = csp.chan(csp.buffers.dropping(1));
//   element.addEventListener(eventName, function(event) {
//     csp.putAsync(ch, event, noOp);
//   });
//   return ch;
// }
   