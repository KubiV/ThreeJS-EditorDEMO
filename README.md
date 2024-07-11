# 3D Visualisations and Labels - ThreeJS DEMO

Run from "threjsdemo" directory using following command:
`node server.js`

The labels shown in `index.html` (so called "Vizualizace" window, labels are only visible here) are stored in `labels.json` file. To add another label you can open the editor (`editor.html`) and by changing the Distance (with the slider) you modify the label distance from the model surface, Description changes the text inside the label. And finally you click at the spot on the model where you want to add the label.

```
{
    "stlFileName": "Femur.stl",
    "labels": [
      {
        "text": "Fovea capitis",
        "surfacePoint": { "x": 10.326813061675978, "y": 4.7791189670994765, "z": 81.14730270379326 },
        "secondPoint": { "x": 30.25317981731997, "y": 3.4558882540707616, "z": 80.05690442808687 }
      },
      {
        "text": "Condylus",
        "surfacePoint": { "x": 15.140688108341635, "y": -4.7376935952566726, "z": -74.8820080103288 },
        "secondPoint": { "x": 19.1874472279981, "y": 14.832463684132051, "z": -74.08659322075933 }
      },
      {
        "text": "Trochanter minor",
        "surfacePoint": { "x": -1.5127412901604842, "y": 17.391634879562297, "z": 54.65190100886029 },
        "secondPoint": { "x": 66.67774927519761, "y": 73.19037711891488, "z": 25.960887486119447 }
      }
    ]
  }
```

## To do

* Make more comments to the code
* Menu for disabling labels
* Import model and labels by having them listed in the URL
* Labels editor - list view in editor and remove them
* Add general description to right div where is now placeholder "Popisek"
