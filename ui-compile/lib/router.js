// The router: one cheap check decides whether a chest screen is ours at all,
// a second decides which layout it is.
//
// Both keys ride the sentinel in slot 0. Its item id is the protocol key, shared
// by every compiled screen; its remaining durability is the layout key, so the
// binding reads the id straight back without arithmetic. A vanilla chest has no
// marker there, fails the first check, and renders untouched — absence IS the
// vanilla path, so nothing has to special-case it.
//
// Every number here is a literal on purpose. A `$variable` inside a
// `source_property_name` is silently dropped in a subtree the engine inserted
// through `modifications`, which cost six in-game attempts to establish.

/**
 * `collection_index` is only accepted on a direct child of a control declaring
 * `collection_name`, and that is only legal on stack_panel/grid. So anything
 * reading a slot gets a one-child host directly above it.
 *
 * @param {string} child   name of the control the host wraps
 * @param {string} collection
 */
const host = (child, collection) => ({
  type: 'stack_panel',
  orientation: 'vertical',
  size: ['100%', '100%'],
  collection_name: collection,
  controls: [{ [child]: { collection_index: 0 } }],
});

const sentinelBindings = (collection) => [
  { binding_type: 'collection_details', binding_collection_name: collection },
  {
    binding_name: '#item_id_aux',
    binding_name_override: '#aux',
    binding_type: 'collection',
    binding_collection_name: collection,
  },
  {
    binding_name: '#item_durability_current_amount',
    binding_name_override: '#layout',
    binding_type: 'collection',
    binding_collection_name: collection,
  },
];

/**
 * @param {object} options
 * @param {{ name: string, namespace: string, entry: string, layoutId: number }[]} options.screens
 * @param {string} options.collection
 * @param {number} options.protocolAux aux id of the marker item in slot 0
 * @returns {object} a JSON UI document in the `chest` namespace
 */
export function buildRouter({ screens, collection, protocolAux }) {
  /** @type {Record<string, unknown>} */
  const document = { namespace: 'chest' };

  for (const screen of screens) {
    document[`bcui_gate_${screen.name}`] = {
      type: 'panel',
      size: ['100%', '100%'],
      layer: 5,
      controls: [{ [`layout@${screen.namespace}.${screen.entry}`]: {} }],
      bindings: [
        ...sentinelBindings(collection),
        {
          binding_type: 'view',
          source_property_name: `((#aux = ${protocolAux}) and (#layout = ${screen.layoutId}))`,
          target_property_name: '#visible',
        },
      ],
    };

    document[`bcui_host_${screen.name}`] = host(`gate@chest.bcui_gate_${screen.name}`, collection);
  }

  // True only when no compiled layout claimed the screen, i.e. an ordinary
  // chest. Vanilla's own visual content is re-emitted here, behind the inverted
  // gate, because the replacement below takes the whole screen.
  document['bcui_vanilla_gate'] = {
    type: 'panel',
    size: ['100%', '100%'],
    layer: 5,
    controls: [
      { 'common_panel@common.common_panel': {} },
      { 'small_chest_panel_top_half@chest.small_chest_panel_top_half': {} },
      { 'inventory_panel_bottom_half_with_label@common.inventory_panel_bottom_half_with_label': {} },
      { 'hotbar_grid@common.hotbar_grid_template': {} },
    ],
    bindings: [
      ...sentinelBindings(collection),
      {
        binding_type: 'view',
        source_property_name: `(not (#aux = ${protocolAux}))`,
        target_property_name: '#visible',
      },
    ],
  };

  document['bcui_vanilla_host'] = host('gate@chest.bcui_vanilla_gate', collection);

  // The WHOLE screen, not the strip above the player's inventory.
  //
  // A compiled screen decides everything that is drawn, so the background, the
  // player's inventory and the hotbar are no longer free -- a screen asks for
  // them by name or does without. What is NOT optional is the functional
  // chrome: without `flying_item_renderer` a dragged item is invisible, without
  // the take-progress button touch controls cannot take, and without the
  // gamepad cursor a controller cannot move. Those are emitted for both paths.
  //
  // Wholesale replacement rather than a modification: a replacement is a normal
  // control tree, so cross-namespace @-bases resolve inside it.
  document['small_chest_panel'] = {
    type: 'panel',
    controls: [
      { 'container_gamepad_helpers@common.container_gamepad_helpers': {} },
      { 'selected_item_details_factory@common.selected_item_details_factory': {} },
      { 'item_lock_notification_factory@common.item_lock_notification_factory': {} },
      {
        'root_panel@common.root_panel': {
          layer: 1,
          controls: [
            { 'vanilla@chest.bcui_vanilla_host': {} },
            ...screens.map(screen => ({ [`${screen.name}@chest.bcui_host_${screen.name}`]: {} })),
            { 'inventory_take_progress_icon_button@common.inventory_take_progress_icon_button': {} },
            { 'flying_item_renderer@common.flying_item_renderer': { layer: 15 } },
            { 'inventory_selected_icon_button@common.inventory_selected_icon_button': {} },
            { 'gamepad_cursor@common.gamepad_cursor_button': {} },
          ],
        },
      },
    ],
  };

  return document;
}
