import coronaryData from './coronary.json';
import heartTransformData from './heartTransform.json';
import type { VesselConfig, CoronaryDataConfig, HeartTransformConfig } from '../types/viewer';

export const coronaryConfig = coronaryData as unknown as CoronaryDataConfig;
export const vesselsList: VesselConfig[] = coronaryConfig.vessels;
export const defaultHeartTransform = heartTransformData as unknown as HeartTransformConfig;
