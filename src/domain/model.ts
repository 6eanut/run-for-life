export interface Split {
  index: number;
  durationSeconds: number | null;
  paceSecondsPerKm: number | null;
  heartRateBpm: number | null;
  isPartialSplit?: boolean;
}

export interface RunRecord {
  id?: string;
  activityType: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  averagePaceSecondsPerKm: number | null;
  averageHeartRateBpm: number | null;
  averageCadenceSpm: number | null;
  averagePowerWatts: number | null;
  activeCaloriesKcal: number | null;
  totalCaloriesKcal: number | null;
  elevationGainMeters: number | null;
  effortLevel: number | null;
  effortDescription: string | null;
  temperatureCelsius: number | null;
  humidityPercent: number | null;
  airQualityIndex: number | null;
  location: string | null;
  source: string | null;
  awards: string[];
  splits: Split[];
  challenge: { requiredDurationSeconds: number; completed: boolean; completedCount: number };
}

export function emptyRecord(): RunRecord {
  return {
    activityType:null,date:null,startTime:null,endTime:null,timezone:null,
    durationSeconds:null,distanceKm:null,averagePaceSecondsPerKm:null,
    averageHeartRateBpm:null,averageCadenceSpm:null,averagePowerWatts:null,
    activeCaloriesKcal:null,totalCaloriesKcal:null,elevationGainMeters:null,
    effortLevel:null,effortDescription:null,temperatureCelsius:null,
    humidityPercent:null,airQualityIndex:null,location:null,source:null,
    awards:[],splits:[],challenge:{requiredDurationSeconds:1800,completed:false,completedCount:0},
  };
}
