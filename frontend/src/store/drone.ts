import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Waypoint, NoFlyZone, TerrainPoint, FlightPlan, DroneConfig } from '../types';
import {
  aStarPathfind,
  rrtPathfind,
  smoothPath,
  calculateFlightStats,
  checkTerrainCollision,
  exportKML,
  mockNoFlyZones,
  mockTerrainData,
} from '../utils/pathfinding';

export const useDroneStore = defineStore('drone', () => {
  const waypoints = ref<Waypoint[]>([]);
  const noFlyZones = ref<NoFlyZone[]>([]);
  const terrainData = ref<TerrainPoint[]>([]);
  const currentPlan = ref<FlightPlan | null>(null);
  const selectedAlgorithm = ref<'astar' | 'rrt'>('astar');
  const isSimulating = ref(false);
  const isPaused = ref(false);
  const isDragging = ref(false);
  const wasPlayingBeforeDrag = ref(false);
  const simProgress = ref(0);
  const simSpeed = ref<1 | 2 | 4 | 8>(1);
  const mapCenter = ref<[number, number]>([39.9, 116.4]);

  const droneConfig = ref<DroneConfig>({
    maxAltitude: 500,
    maxSpeed: 20,
    batteryCapacity: 5000,
    consumptionRate: 100,
    safeDistance: 30,
  });

  // ─── Actions ──────────────────────────────────────────────────────────────
  function addWaypoint(
    lat: number,
    lng: number,
    altitude = 100,
    speed = 10,
    action: Waypoint['action'] = 'none'
  ) {
    const id = `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    waypoints.value.push({ id, lat, lng, altitude, speed, action });
  }

  function removeWaypoint(id: string) {
    waypoints.value = waypoints.value.filter((w) => w.id !== id);
  }

  function updateWaypoint(id: string, updates: Partial<Waypoint>) {
    const wp = waypoints.value.find((w) => w.id === id);
    if (wp) Object.assign(wp, updates);
  }

  function planRoute(start: [number, number], goal: [number, number]) {
    const bounds = { minLat: 39.85, maxLat: 39.95, minLng: 116.35, maxLng: 116.45 };
    let raw: Waypoint[];
    if (selectedAlgorithm.value === 'astar') {
      raw = aStarPathfind(start, goal, 30, noFlyZones.value, bounds);
    } else {
      raw = rrtPathfind(start, goal, noFlyZones.value);
    }
    const smoothed = smoothPath(raw);
    waypoints.value = smoothed;
    updatePlan();
  }

  function clearRoute() {
    waypoints.value = [];
    currentPlan.value = null;
    simProgress.value = 0;
    isSimulating.value = false;
    isPaused.value = false;
    isDragging.value = false;
    wasPlayingBeforeDrag.value = false;
    if (simInterval) {
      clearInterval(simInterval);
      simInterval = null;
    }
  }

  function updatePlan() {
    const stats = calculateFlightStats(waypoints.value, droneConfig.value);
    currentPlan.value = {
      id: `plan-${Date.now()}`,
      name: 'Flight Plan',
      waypoints: [...waypoints.value],
      totalDistance: stats.totalDistance,
      estimatedTime: stats.estimatedTime,
      batteryUsage: stats.batteryUsage,
    };
  }

  let simInterval: ReturnType<typeof setInterval> | null = null;

  function startSimulation() {
    const baseInterval = 50;
    const speedMultiplier = simSpeed.value;
    const increment = 1 * speedMultiplier;
    simInterval = setInterval(() => {
      simProgress.value = Math.min(100, simProgress.value + increment);
      if (simProgress.value >= 100) {
        simProgress.value = 100;
        isSimulating.value = false;
        isPaused.value = false;
        if (simInterval) {
          clearInterval(simInterval);
          simInterval = null;
        }
      }
    }, baseInterval);
  }

  function simulateFlight() {
    if (waypoints.value.length < 2) return;
    if (isSimulating.value && isPaused.value) {
      isPaused.value = false;
      startSimulation();
      return;
    }
    if (isSimulating.value) return;
    isSimulating.value = true;
    isPaused.value = false;
    simProgress.value = 0;
    startSimulation();
  }

  function togglePause() {
    if (!isSimulating.value) return;
    if (isPaused.value) {
      isPaused.value = false;
      startSimulation();
    } else {
      isPaused.value = true;
      if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
      }
    }
  }

  function setSimSpeed(speed: 1 | 2 | 4 | 8) {
    simSpeed.value = speed;
    if (isSimulating.value && !isPaused.value && simInterval) {
      clearInterval(simInterval);
      simInterval = null;
      startSimulation();
    }
  }

  function setSimProgress(progress: number) {
    simProgress.value = Math.max(0, Math.min(100, progress));
    if (simProgress.value >= 100) {
      isSimulating.value = false;
      isPaused.value = false;
      isDragging.value = false;
      wasPlayingBeforeDrag.value = false;
      if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
      }
    }
  }

  function startDrag() {
    if (simProgress.value >= 100) return;
    isDragging.value = true;
    wasPlayingBeforeDrag.value = isSimulating.value && !isPaused.value;
    if (wasPlayingBeforeDrag.value && simInterval) {
      clearInterval(simInterval);
      simInterval = null;
    }
    isPaused.value = true;
  }

  function endDrag() {
    if (!isDragging.value) return;
    isDragging.value = false;
    if (simProgress.value >= 100) {
      wasPlayingBeforeDrag.value = false;
      return;
    }
    if (wasPlayingBeforeDrag.value) {
      isPaused.value = false;
      isSimulating.value = true;
      startSimulation();
    }
    wasPlayingBeforeDrag.value = false;
  }

  function loadMockData() {
    noFlyZones.value = mockNoFlyZones;
    terrainData.value = mockTerrainData;
  }

  function exportPlan(): string {
    if (!currentPlan.value) return '';
    return exportKML(currentPlan.value);
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const totalDistance = computed(() => {
    if (!currentPlan.value) return 0;
    return currentPlan.value.totalDistance;
  });

  const estimatedTime = computed(() => {
    if (!currentPlan.value) return 0;
    return currentPlan.value.estimatedTime;
  });

  const batteryPercent = computed(() => {
    if (!currentPlan.value) return 0;
    return currentPlan.value.batteryUsage;
  });

  const terrainProfile = computed(() => {
    if (waypoints.value.length < 2) return [];
    return waypoints.value.map((wp) => {
      let nearestElev = 0;
      let minDist = Infinity;
      for (const tp of terrainData.value) {
        const d =
          (tp.lat - wp.lat) ** 2 + (tp.lng - wp.lng) ** 2;
        if (d < minDist) {
          minDist = d;
          nearestElev = tp.elevation;
        }
      }
      return {
        lat: wp.lat,
        lng: wp.lng,
        altitude: wp.altitude,
        terrainElevation: nearestElev,
      };
    });
  });

  const currentSimPosition = computed(() => {
    if (waypoints.value.length < 2) return null;
    const progress = simProgress.value / 100;
    const totalWp = waypoints.value.length;
    const segIdx = Math.min(Math.floor(progress * (totalWp - 1)), totalWp - 2);
    const segProgress = (progress * (totalWp - 1)) - segIdx;
    const wp1 = waypoints.value[segIdx];
    const wp2 = waypoints.value[segIdx + 1];
    const lat = wp1.lat + (wp2.lat - wp1.lat) * segProgress;
    const lng = wp1.lng + (wp2.lng - wp1.lng) * segProgress;
    const altitude = wp1.altitude + (wp2.altitude - wp1.altitude) * segProgress;
    const speed = wp1.speed + (wp2.speed - wp1.speed) * segProgress;
    return { lat, lng, altitude, speed, segIdx, segProgress };
  });

  const currentSimStats = computed(() => {
    if (!currentPlan.value || waypoints.value.length < 2) {
      return {
        traveledDistance: 0,
        elapsedTime: 0,
        batteryUsed: 0,
        remainingDistance: 0,
        remainingTime: 0,
        remainingBattery: 0,
      };
    }
    const progress = simProgress.value / 100;
    const totalDist = currentPlan.value.totalDistance;
    const totalTime = currentPlan.value.estimatedTime;
    const totalBattery = currentPlan.value.batteryUsage;

    const traveledDistance = totalDist * progress;
    const elapsedTime = totalTime * progress;
    const batteryUsed = totalBattery * progress;

    return {
      traveledDistance,
      elapsedTime,
      batteryUsed,
      remainingDistance: totalDist - traveledDistance,
      remainingTime: totalTime - elapsedTime,
      remainingBattery: totalBattery - batteryUsed,
    };
  });

  return {
    waypoints,
    noFlyZones,
    terrainData,
    currentPlan,
    droneConfig,
    selectedAlgorithm,
    isSimulating,
    isPaused,
    isDragging,
    simProgress,
    simSpeed,
    mapCenter,
    totalDistance,
    estimatedTime,
    batteryPercent,
    terrainProfile,
    currentSimPosition,
    currentSimStats,
    addWaypoint,
    removeWaypoint,
    updateWaypoint,
    planRoute,
    clearRoute,
    simulateFlight,
    togglePause,
    setSimSpeed,
    setSimProgress,
    startDrag,
    endDrag,
    loadMockData,
    exportPlan,
    updatePlan,
  };
});
