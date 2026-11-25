import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { LabId } from '../types';

export const LABS: Record<LabId, LazyExoticComponent<ComponentType>> = {
  spark: lazy(() => import('./SparkLab')),
  flink: lazy(() => import('./FlinkLab')),
  parquet: lazy(() => import('./ParquetLab')),
  iceberg: lazy(() => import('./IcebergLab')),
  airflow: lazy(() => import('./AirflowLab')),
  cdc: lazy(() => import('./CdcLab')),
  olap: lazy(() => import('./OlapLab')),
};

export const LAB_TITLE: Record<LabId, string> = {
  spark: 'Spark: DAG, stages, shuffle & skew',
  flink: 'Flink: watermarks & checkpoint barriers',
  parquet: 'Parquet: columnar layout & predicate pushdown',
  iceberg: 'Iceberg: snapshots, manifests & time travel',
  airflow: 'Airflow: scheduler, executor & backfill',
  cdc: 'CDC: reading the write-ahead log',
  olap: 'OLAP: segments, rollup & indexes',
};
