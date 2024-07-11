# 3D Visualisations and Labels - ThreeJS DEMO

Run from the "threejsdemo/public" folder using following command:
`npm run dev`
or in "threjsdemo" folder using:
`node server.js`

In Editor window you can by clicking on the model create a .txt file, where are stored 2 sets of coordinates - one for the point on the model, second for the tag placement. Afterwards you can modify the labels inside the `labels.json` after following this scheme using the values inside the .txt:

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

* Make automatic coordinates addition to labels.json
* Make text addition posible from menu
* Add back link from editor
* Make more comments to the code
* Menu for disabling labels
