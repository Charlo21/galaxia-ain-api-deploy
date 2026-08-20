export interface NodeCapabilities {
  cpu_cores: number;
  gpu: boolean;
  ram_gb: number;
  models: string[]; // List of model IDs this node can run
}

export interface NodeLocation {
  country: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
  ip: string;
}

export interface Node {
  id: string;
  device_id: string;
  wallet_address: string;
  capabilities: NodeCapabilities;
  location: NodeLocation;
  uptime_score: number;
  reputation: number;
  tasks_completed: number;
  tasks_failed: number;
  total_earnings: number;
  status: 'online' | 'offline' | 'busy' | 'blocked';
  last_seen: Date;
  registered_at: Date;
  current_load: number;
  max_concurrent_tasks: number;
}

