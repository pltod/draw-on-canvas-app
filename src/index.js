// LIBS
var csp = require("js-csp");
var start = csp.go;
var storage = require("./storage");
var producers = require("./producers");
var cutil = require("./canvas-util");


// STATE
var currentColor = "#62a2fc";
var fileNameToSave = document.getElementById("fname");
var fileNameToOpen = ""


// START CONSUMER CHANNELS
start(canvasClickHandler);
start(selectOnChangeHandler);
start(resetButtonHandler);
start(storeButtonHandler);
start(openButtonHandler);
start(colorPickerHandler);



// LOGIC
function *colorPickerHandler() {
  while (true) {
    var event = yield csp.take(producers.channelColorPicker);
    event.srcElement ? currentColor = event.srcElement.value : currentColor = event.target.value
  }
}

function *openButtonHandler() {
  while (true) {
    var event = yield csp.take(producers.channelOpenButton);
    var drawing = storage.find(fileNameToOpen);
    cutil.visualiseDrawing(drawing);
  }
}

function *storeButtonHandler() {
  while (true) {
    var event = yield csp.take(producers.channelStoreButton);
    storage.save(fileNameToSave.innerHTML, canvas.toDataURL());
    fileNameToSave.innerHTML = "";
  }
}

function *resetButtonHandler() {
  while (true) {
    var event = yield csp.take(producers.channelResetButton);
    cutil.clearCanvas();
  }
}

function *selectOnChangeHandler() {
  while (true) {
    var event = yield csp.take(producers.channelSelectFile);
    event.srcElement ? fileNameToOpen = event.srcElement.value : fileNameToOpen = event.target.value;
  }
}

function *canvasClickHandler() {
  var counter = 1;
  var points = [];
  while (true) {
    var event = yield csp.take(producers.channelCanvas);
    
    if (counter < 3) { 
      points.push(cutil.getCoordinates(event)); 
      counter++;
    } else {
      points.push(cutil.getCoordinates(event)); 
      cutil.drawTriangle(points, currentColor);
      counter = 1;
      points = [];
    }
  }
}
