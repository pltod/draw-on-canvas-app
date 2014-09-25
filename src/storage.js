var _ = require("underscore");

function getDrawingsFromLocalStorage() {
  var currentDrawings = localStorage["drawings"];
  if (currentDrawings === undefined 
    || currentDrawings === null
    || currentDrawings === "null"
    || currentDrawings === ""
    || ! currentDrawings instanceof Array ) {
      return [];
    } else {
      return JSON.parse(currentDrawings);
    }
}

function findDrawingByName(drawings, drawingName) {
  var drawing = _.where(drawings, {name: drawingName});
  return drawing[0];
}

module.exports = {
  getAllDrawingNames: function () {
    var drawings = getDrawingsFromLocalStorage();
    return _.map(drawings, function (drawing) {
      return drawing.name
    })
  },  
  save: function (drawingName, data) {
    var drawings = getDrawingsFromLocalStorage();
    var drawing;
  
    if (drawingName) {
      drawing = findDrawingByName(drawings, drawingName);
      if (drawing) {
        alert('This name is already used!');
      } else {
        drawings.push({name: drawingName, pic: data});
        localStorage["drawings"] = JSON.stringify(drawings);
        alert('Drawing is saved!');      
      }
    } else {
      alert('Specify file name!');
    } 
  },
  find: function (drawingName) {
    var drawings = getDrawingsFromLocalStorage();
    var drawing;
    if (drawingName) {
      drawing = findDrawingByName(drawings, drawingName);
      if (!drawing) {
        alert("Drawing with such name not found!");
        return null;
      } else {
        return drawing.pic;
      }
    } else {
      alert('Select file to open!');
      return null;
    }
  }
}