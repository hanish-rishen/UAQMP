'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { useEffect, useRef } from 'react';
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

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainer.current) return;
    let map: maplibregl.Map;
    let geolocateControl: GeolocateControl;

    const initializeMap = () => {
      // Start with a default location
      map = new maplibregl.Map({
        container: mapContainer.current!,
        style: `https://api.maptiler.com/maps/basic-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_API_KEY}`,
        center: [0, 0],
        zoom: 2,
        pitch: 45,
        bearing: -17.6,
        canvasContextAttributes: { antialias: true }
      });

      // Add geolocate control
      geolocateControl = new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true
      });

      map.addControl(geolocateControl, 'top-left');

      // Add geocoder and set up map
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

      // Handle map load
      map.on('load', () => {
        // Trigger geolocation after map loads
        geolocateControl.trigger();

        // Add 3D buildings
        const layers = map.getStyle().layers || [];
        let labelLayerId;
        for (const layer of layers) {
          if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
            labelLayerId = layer.id;
            break;
          }
        }

        // Add building layer source and 3D extrusions
        map.addSource('openmaptiles', {
          type: 'vector',
          url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${process.env.NEXT_PUBLIC_MAPTILER_API_KEY}`
        });

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
      });

      // Handle geolocation events
      geolocateControl.on('geolocate', (position: GeolocationPosition) => {
        const { longitude, latitude } = position.coords;
        console.log('Location updated:', { longitude, latitude });
        
        map.easeTo({
          center: [longitude, latitude],
          zoom: 15.5,
          pitch: 45,
          bearing: -17.6,
          duration: 2000
        });
      });
    };

    initializeMap();

    return () => map?.remove();
  }, []);

  return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />;
}
