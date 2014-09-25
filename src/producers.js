// LIBS
var csp = require("js-csp");

// DOM Elements
var canvas = document.getElementById("canvas");
var resetButton = document.getElementById("reset");
var storeButton = document.getElementById("store");
var openButton = document.getElementById("open");
var colorPicker = document.getElementById("colorPicker");
var selectFile = document.getElementById("selectFile");

// PRODUCER CHANNELS

function noOp() {};

function createChannel(element, eventName) {
  var ch = csp.chan(csp.buffers.dropping(1));
  element.addEventListener(eventName, function(event) {
    csp.putAsync(ch, event, noOp);
  });
  return ch;
}


module.exports = {
  channelResetButton: createChannel(resetButton, "click"),
  channelStoreButton: createChannel(storeButton, "click"),
  channelOpenButton: createChannel(openButton, "click"),
  channelColorPicker: createChannel(colorPicker, "input"),
  channelCanvas: createChannel(canvas, "click"),
  channelSelectFile: createChannel(selectFile, "change")
}