// Sample data for RapidSystem tests

export const gpxWithPoints = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <wpt lat="40.7128" lon="-74.0060">
    <name>New York</name>
  </wpt>
  <wpt lat="34.0522" lon="-118.2437">
    <name>Los Angeles</name>
  </wpt>
</gpx>`;

export const gpxRectangularBounds = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk>
    <trkseg>
      <trkpt lat="40.0" lon="-75.0"/>
      <trkpt lat="40.0" lon="-74.0"/>
      <trkpt lat="41.0" lon="-74.0"/>
      <trkpt lat="41.0" lon="-75.0"/>
      <trkpt lat="40.0" lon="-75.0"/>
    </trkseg>
  </trk>
</gpx>`;

export const gpxNonRectangularBounds = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk>
    <trkseg>
      <trkpt lat="40.0" lon="-75.0"/>
      <trkpt lat="40.5" lon="-74.5"/>
      <trkpt lat="41.0" lon="-74.0"/>
      <trkpt lat="40.0" lon="-75.0"/>
    </trkseg>
  </trk>
</gpx>`;
