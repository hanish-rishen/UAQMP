'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { useEffect, useRef, useCallback } from 'react';
import maplibregl, { GeolocateControl } from 'maplibre-gl';
import MaplibreGeocoder, { 
  MaplibreGeocoderApi, 
  MaplibreGeocoderApiConfig,
  CarmenGeojsonFeature
} from '@maplibre/maplibre-gl-geocoder';

interface GeocodingFeature {
  center: [number, number];
  place_name: string;
  text: string;
  properties: Record<string, unknown>;
}

interface AirQualityData {
  aqi: number;
  components: {
    co: number;
    no2: number;
    o3: number;
    pm2_5: number;
    pm10: number;
  };
  lat: number;
  lon: number;
}

// Create geocoder API implementation
const geocoderApi: MaplibreGeocoderApi = {
  forwardGeocode: async (config: MaplibreGeocoderApiConfig) => {
    const features: CarmenGeojsonFeature[] = [];
    try {
      const request = `https://api.maptiler.com/geocoding/${config.query}.json?key=${process.env.NEXT_PUBLIC_MAPTILER_API_KEY}`;
      const response = await fetch(request);
      const geojson = await response.json() as { features: GeocodingFeature[] };
      
      features.push(...geojson.features.map(feature => ({
        id: `${feature.center[0]},${feature.center[1]}`,
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: feature.center
        },
        place_name: feature.place_name,
        properties: feature.properties,
        text: feature.text,
        place_type: ['place'],
        center: feature.center,
        relevance: 1,
        language: 'en',
        bbox: undefined
      })));
    } catch (e) {
      console.error('Failed to forwardGeocode:', e instanceof Error ? e.message : String(e));
    }
    return {
      type: 'FeatureCollection',
      features
    };
  },
  reverseGeocode: async (config: MaplibreGeocoderApiConfig) => {
    console.log('Reverse geocoding request:', config);
    return {
      type: 'FeatureCollection',
      features: []
    };
  }
};

// Update getAirQuality function with better error handling and logging
const getAirQuality = async (lat: number, lon: number): Promise<AirQualityData> => {
  console.log('Fetching AQI data for:', { lat, lon });
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${process.env.NEXT_PUBLIC_OPENWEATHERMAP_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Raw AQI data:', data);
    
    if (!data.list?.[0]) {
      throw new Error('Invalid API response format');
    }

    return {
      aqi: data.list[0].main.aqi,
      components: {
        co: data.list[0].components.co,
        no2: data.list[0].components.no2,
        o3: data.list[0].components.o3,
        pm2_5: data.list[0].components.pm2_5,
        pm10: data.list[0].components.pm10
      },
      lat,
      lon
    };
  } catch (error) {
    console.error('AQI fetch error:', error);
    throw error;
  }
};

// Add AQI calculation helper
const calculateAQI = (components: { pm2_5: number; pm10: number; no2: number; o3: number }) => {
  // Standard EPA breakpoints for PM2.5
  const pm25 = components.pm2_5;
  if (pm25 <= 12.0) return Math.linear(0, 12.0, 0, 50, pm25);
  if (pm25 <= 35.4) return Math.linear(12.1, 35.4, 51, 100, pm25);
  if (pm25 <= 55.4) return Math.linear(35.5, 55.4, 101, 150, pm25);
  if (pm25 <= 150.4) return Math.linear(55.5, 150.4, 151, 200, pm25);
  if (pm25 <= 250.4) return Math.linear(150.5, 250.4, 201, 300, pm25);
  if (pm25 <= 350.4) return Math.linear(250.5, 350.4, 301, 400, pm25);
  return Math.linear(350.5, 500.4, 401, 500, pm25);
};

// Add linear interpolation helper
Math.linear = (x1: number, x2: number, y1: number, y2: number, x: number) => {
  return Math.round(y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
};

// Update color function with proper AQI ranges
const getAqiColor = (aqi: number): string => {
  if (aqi <= 50) return 'rgba(50, 255, 50, 0.8)';      // Good - Green
  if (aqi <= 100) return 'rgba(255, 255, 50, 0.8)';    // Moderate - Yellow
  if (aqi <= 150) return 'rgba(255, 126, 0, 0.8)';     // Unhealthy for Sensitive - Orange
  if (aqi <= 200) return 'rgba(255, 0, 0, 0.85)';      // Unhealthy - Red
  if (aqi <= 300) return 'rgba(153, 0, 76, 0.85)';     // Very Unhealthy - Purple
  return 'rgba(126, 0, 35, 0.85)';                     // Hazardous - Maroon
};

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geolocateControlRef = useRef<GeolocateControl | null>(null);

  const updatePollutionLayer = async (
    map: maplibregl.Map,
    longitude: number,
    latitude: number
  ) => {
    if (!map || !map.loaded()) return;

    try {
      console.log('Updating pollution layer for:', { longitude, latitude });

      // Remove existing layers
      ['pollution-visualization', 'aqi-text'].forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      });

      if (map.getSource('pollution-area')) {
        map.removeSource('pollution-area');
      }

      // Fetch new AQI data
      const aqData = await getAirQuality(latitude, longitude);
      const calculatedAQI = calculateAQI(aqData.components);
      console.log('Calculated AQI:', calculatedAQI);

      // Add pollution source
      map.addSource('pollution-area', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            aqi: calculatedAQI,
            ...aqData.components
          },
          geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          }
        }
      });

      // Add haze effect layer
      map.addLayer({
        id: 'pollution-visualization',
        type: 'circle',
        source: 'pollution-area',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 100,    // Larger base radius
            15, 300     // Larger max radius
          ],
          'circle-color': getAqiColor(calculatedAQI),
          'circle-blur': 2,        // Increased blur
          'circle-opacity': 0.85   // Increased opacity
        }
      });

      // Fix text display
      map.addLayer({
        id: 'aqi-text',
        type: 'symbol',
        source: 'pollution-area',
        layout: {
          'text-field': [
            'format',
            'Air Quality Index: ', 
            ['number-format', ['get', 'aqi'], { 'min-fraction-digits': 0, 'max-fraction-digits': 0 }],
            '\nPM2.5: ',
            ['number-format', ['get', 'pm2_5'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }],
            ' µg/m³',
            '\nPM10: ',
            ['number-format', ['get', 'pm10'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }],
            ' µg/m³',
            '\nNO₂: ',
            ['number-format', ['get', 'no2'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }],
            ' µg/m³',
            '\nO₃: ',
            ['number-format', ['get', 'o3'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }],
            ' µg/m³'
          ],
          'text-size': 14,
          'text-offset': [0, -4],
          'text-anchor': 'top'
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 2
        }
      });

    } catch (error) {
      console.error('Error updating pollution layer:', error);
    }
  };

  const setupEventHandlers = useCallback((
    map: maplibregl.Map,
    geolocateControl: GeolocateControl,
    geocoder: MaplibreGeocoder
  ) => {
    geolocateControl.on('geolocate', (position: GeolocationPosition) => {
      const { longitude, latitude } = position.coords;
      updatePollutionLayer(map, longitude, latitude);
    });

    geocoder.on('result', (e) => {
      if (e.result.center) {
        updatePollutionLayer(map, e.result.center[0], e.result.center[1]);
      }
    });
  }, []);

  useEffect(() => {
    if (!mapContainer.current) return;

    const initializeMap = async () => {
      const map = new maplibregl.Map({
        container: mapContainer.current!,
        style: `https://api.maptiler.com/maps/basic-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_API_KEY}`,
        center: [0, 0],
        zoom: 2,
        pitch: 45,
        bearing: -17.6,
        canvasContextAttributes: { antialias: true }
      });

      mapRef.current = map;

      await new Promise<void>(resolve => {
        map.on('load', resolve);
      });

      const geolocateControl = new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
          timeout: 2000, // Reduced timeout
          maximumAge: 0
        },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true
      });

      map.addControl(geolocateControl, 'top-left');

      const geocoder = new MaplibreGeocoder(
        geocoderApi,
        {
          maplibregl,
          marker: true,
          collapsed: false,
          clearAndBlurOnEsc: true,
          clearOnBlur: true,
          showResultsWhileTyping: true,
          minLength: 2,
          limit: 5
        }
      );

      map.addControl(geocoder, 'top-left');

      // Set up handlers
      setupEventHandlers(map, geolocateControl, geocoder);

      // Add map layers
      setupMapLayers(map);

      // Trigger geolocation immediately
      geolocateControl.trigger();
    };

    initializeMap().catch(console.error);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [setupEventHandlers]);

  const setupMapLayers = (map: maplibregl.Map) => {
    // Add building layers
    const layers = map.getStyle().layers || [];
    let labelLayerId;
    for (const layer of layers) {
      if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
        labelLayerId = layer.id;
        break;
      }
    }

    // Add sources and layers
    if (!map.getSource('openmaptiles')) {
      map.addSource('openmaptiles', {
        type: 'vector',
        url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${process.env.NEXT_PUBLIC_MAPTILER_API_KEY}`
      });
    }

    // Add 3D buildings layer if not already added
    if (!map.getLayer('3d-buildings')) {
      map.addLayer(
        {
          'id': '3d-buildings',
          'source': 'openmaptiles',
          'source-layer': 'building',
          'type': 'fill-extrusion',
          'minzoom': 15,
          'filter': ['!=', ['get', 'hide_3d'], true],
          'paint': {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'render_height'],
              0, 'lightgray',
              200, 'royalblue',
              400, 'lightblue'
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              15,
              0,
              16,
              ['get', 'render_height']
            ],
            'fill-extrusion-base': [
              'case',
              ['>=', ['get', 'zoom'], 16],
              ['get', 'render_min_height'],
              0
            ]
          }
        },
        labelLayerId
      );
    }
  };

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />;
}
