import { world } from '@minecraft/server';

world.afterEvents.worldLoad.subscribe(() => {
  console.warn('World initialized successfully!');
});
