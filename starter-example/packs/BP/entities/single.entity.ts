export default {
  format_version: "1.21.0",
  "minecraft:entity": {
    description: {
      identifier: "example:training_dummy",
      is_summonable: true,
      is_spawnable: false,
      is_experimental: false
    },
    components: {
      "minecraft:health": { value: 20, max: 20 },
      "minecraft:nameable": {},
      "minecraft:collision_box": { width: 0.6, height: 1.8 },
      "minecraft:physics": {}
    }
  }
};
