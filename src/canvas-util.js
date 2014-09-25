// Note that in more complex CSS rules coordinates formula could be different
// The value of this property must be the same as the one specified in the css file
var canvasBorder = 1;
var canvas = document.getElementById("canvas");
var ctx = canvas.getContext('2d');

module.exports = {
  getCoordinates: function (e) {
    var x;
    var y;
    if (e.pageX != undefined && e.pageY != undefined) {
      return {
  	    x: e.pageX - canvas.offsetLeft - 1,
  	    y: e.pageY - canvas.offsetTop - 1
      }
    } else {
      return {
  	    x: e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft - canvas.offsetLeft - canvasBorder,
  	    y: e.clientY + document.body.scrollTop + document.documentElement.scrollTop - canvas.offsetTop - canvasBorder
      }
    }
  },

  drawTriangle: function(points, color) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineTo(points[2].x, points[2].y);
    ctx.fillStyle = color;
    ctx.fill();
  },
  
  visualiseDrawing: function(data) {
    var img = new Image;
    img.src = data;
    img.onload = function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);      
      ctx.drawImage(img, 0, 0)
    }    
  },
  
  clearCanvas: function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);  
  }
}
