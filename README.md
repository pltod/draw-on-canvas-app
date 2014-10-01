**STATE**

> DONE

# Application

## Features

* Draw traingles in the browser

* Store them in local storage

* Open previously stored drawing


Demo: http://pltod.github.io/blog/demos/canvas/

## Notes

* Application is kind of over-engineered in order to experiment with several new concepts

* User interactions are captured and processed with the help of channels that are implemented with javascript generators

* The source files are CommonJS modules that are bundled for the browser with browserify

* Several HTML5 features are used:

> Canvas

> Color Picker

> Content Editable

> Local Storage

# How to run it

* Install / build / open index.html

> ```npm i``` - installs the necessary npm modules

> ```npm run build``` - prepare the source to work in the browser with browserify

> open build/index.html in Chrome with experimental features turned on or in Firefox


* In Development Mode

> ```npm run build-dev``` - run the build with watchify so after each change in the source the build is done automatically. You need just browser refresh to see the changes (but this also could be automated with browser-sync)


### How to turn on chrome experimental features

* Open chrome://flags

* Enable the flag 'Enable Experimental JavaScript'



# References

* Control flow library used in the project

> https://github.com/jlongster/js-csp. This library is in experimental stage so it could have breaking changes in the future. Please make sure that after the installation you have version 0.2.3 in your node_modules folder.

> Ideas behind this approach are described here http://jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript

* Ideas for the main layout from Yahoo's Pure library

> http://purecss.io/

> http://purecss.io/layouts/blog/ - this layout in particular

* Canvas Tutorials

> http://www.html5canvastutorials.com/

> http://diveintohtml5.info/canvas.html

* Saving To Local Storage

> https://hacks.mozilla.org/2012/02/saving-images-and-files-in-localstorage/

* Content Editable Styling

> http://jsfiddle.net/RZZ6X/

