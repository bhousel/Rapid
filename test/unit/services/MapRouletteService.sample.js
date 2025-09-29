/* eslint-disable quotes */

// data near [10°, 0°]
export const data10 = [
  {
    "id": 1,
    "owner": -1,
    "ownerName": "",
    "title": "w1@1",
    "parentId": 100,
    "parentName": "Unconnected Crosswalks",
    "point": { "lat": 0, "lng": 10.0001 },
    "bounding": "",
    "blurb": "Good luck!",
    "modified": "2025-09-01T00:00:01Z",
    "difficulty": -1,
    "type": 2,
    "status": 0,
    "pointReview": {},
    "priority": 0
  },
  {
    "id": 2,
    "owner": -1,
    "ownerName": "",
    "title": "w2@1",
    "parentId": 100,
    "parentName": "Unconnected Crosswalks",
    "point": { "lat": 0, "lng": 10.0002 },
    "bounding": "",
    "blurb": "Good luck!",
    "modified": "2025-09-01T00:00:01Z",
    "difficulty": -1,
    "type": 2,
    "status": 0,
    "pointReview": {},
    "priority": 0
  },
  {
    "id": 3,
    "owner": -1,
    "ownerName": "",
    "title": "w3@1",
    "parentId": 100,
    "parentName": "Unconnected Crosswalks",
    "point": { "lat": 0, "lng": 10.0003 },
    "bounding": "",
    "blurb": "Good luck!",
    "modified": "2025-09-01T00:00:01Z",
    "difficulty": -1,
    "type": 2,
    "status": 0,
    "pointReview": {},
    "priority": 0
  }
];


export const challenge100 = {
  "id": 100,
  "name": "Unconnected Crosswalks",
  "created": "2025-09-01T00:00:00Z",
  "modified": "2025-09-01T00:00:01Z",
  "description": "\nCheck if this crosswalk is connected.\n",
  "deleted": false,
  "isGlobal": false,
  "requireConfirmation": false,
  "requireRejectReason": false,
  "infoLink": "",
  "owner": 12345,
  "parent": 6789,
  "instruction": "\nCheck the crosswalk ({{osmIdentifier}}) and ensure it is correctly connected.\n",
  "difficulty": 2,
  "blurb": "Good luck!",
  "enabled": true,
  "featured": false,
  "cooperativeType": 0,
  "popularity": 1,
  "checkinComment": "Fixed #UnconnectedCrosswalks #maproulette",
  "checkinSource": "",
  "virtualParents": [],
  "requiresLocal": false,
  "overpassQL": "",
  "remoteGeoJson": "",
  "overpassTargetType": "",
  "defaultPriority": 0,
  "highPriorityRule": {},
  "mediumPriorityRule": {},
  "lowPriorityRule": {},
  "highPriorityBounds": [],
  "mediumPriorityBounds": [],
  "lowPriorityBounds": [],
  "defaultZoom": 13,
  "minZoom": 1,
  "maxZoom": 19,
  "updateTasks": false,
  "limitTags": false,
  "limitReviewTags": false,
  "isArchived": false,
  "reviewSetting": 0,
  "defaultBasemap": -1,
  "defaultBasemapId": "",
  "customBasemap": "",
  "exportableProperties": "",
  "osmIdProperty": "identifier",
  "taskBundleIdProperty": "",
  "taskWidgetLayout": {},
  "presets": [],
  "status": 3,
  "statusMessage": "",
  "lastTaskRefresh": "2025-09-01T00:00:00Z",
  "dataOriginDate": "2025-09-01T00:00:00Z",
  "location": {
    "type": "Point",
    "coordinates": [ 10, 0 ]
  },
  "bounding": {
    "type": "Polygon",
    "coordinates": [
      [
        [9.9975, -0.0219 ],
        [9.9975, 0 ],
        [10.0195, 0 ],
        [10.0195, -0.0219 ],
        [9.9975, -0.0219 ],
      ]
    ]
  },
  "completionPercentage": 1,
  "tasksRemaining": 10,
  "tags": [
    "unconnected_crosswalk"
  ]
};
