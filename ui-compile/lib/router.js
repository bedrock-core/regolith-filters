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
 * The player's inventory and hotbar, redrawn so a transport item is invisible.
 *
 * A button press auto-places its transport into the player's inventory, and
 * vanilla's grids would draw it there for the tick it takes the script to pull
 * it back. These are clones of vanilla's own grid trees with ONE swap: the item
 * renderer is wrapped in a panel that reads the slot's id and durability and
 * hides itself when both match the transport — the same two-literal check the
 * router itself runs on the sentinel. The durability bar rides inside the same
 * wrapper (vanilla's own is turned off), so a damaged transport does not leave
 * a stray bar floating over an apparently empty cell.
 *
 * Cloned rather than modified: vanilla's `container_item` hardcodes its bar and
 * takes only the renderer as a variable, so the wrapper is the one seam wide
 * enough to carry both.
 *
 * @param {number} protocolAux
 * @param {number} transportOrdinal
 * @returns {Record<string, unknown>} definitions for the `chest` namespace
 */
const hiddenItemGrids = (protocolAux, transportOrdinal) => ({
  // The seam: vanilla's item renderer plus its durability bar, gated together.
  // `$item_collection_name` flows down from the grid item exactly as it does
  // into vanilla's own bar — a variable is legal there, since this whole tree
  // is a normal replacement, not a `modifications` insert.
  bcui_gated_item: {
    type: 'panel',
    size: ['100%', '100%'],
    controls: [
      { 'renderer@common.item_renderer': { size: ['100%', '100%'] } },
      {
        'durability@common.durability_bar': {
          $durability_bar_required: true,
          offset: [0, 5],
          layer: 20,
        },
      },
    ],
    bindings: [
      { binding_type: 'collection_details', binding_collection_name: '$item_collection_name' },
      {
        binding_name: '#item_id_aux',
        binding_name_override: '#aux',
        binding_type: 'collection',
        binding_collection_name: '$item_collection_name',
      },
      {
        binding_name: '#item_durability_current_amount',
        binding_name_override: '#dur',
        binding_type: 'collection',
        binding_collection_name: '$item_collection_name',
      },
      {
        binding_type: 'view',
        source_property_name: `(not ((#aux = ${protocolAux}) and (#dur = ${transportOrdinal})))`,
        target_property_name: '#visible',
      },
    ],
  },

  'bcui_inventory_item@common.container_item': {
    $item_collection_name: 'inventory_items',
    $item_renderer: 'chest.bcui_gated_item',
    // Off so the only bar is the gated one inside the wrapper above.
    $durability_bar_required: false,
  },

  'bcui_hotbar_item@common.container_item': {
    $item_collection_name: 'hotbar_items',
    $item_renderer: 'chest.bcui_gated_item',
    $durability_bar_required: false,
  },

  // Vanilla's `common.inventory_panel`, cell swapped.
  bcui_inventory_panel: {
    type: 'panel',
    size: [88, 83],
    anchor_from: 'bottom_middle',
    anchor_to: 'bottom_middle',
    controls: [
      {
        inventory_grid: {
          type: 'grid',
          size: [162, 54],
          anchor_from: 'bottom_middle',
          anchor_to: 'bottom_middle',
          offset: [0, -26],
          grid_dimensions: [9, 3],
          grid_item_template: 'chest.bcui_inventory_item',
          collection_name: 'inventory_items',
        },
      },
    ],
  },

  // Vanilla's `common.inventory_panel_bottom_half_with_label`, flattened onto
  // the clone above.
  bcui_inventory_panel_with_label: {
    type: 'panel',
    size: ['100%', 93],
    anchor_from: 'bottom_left',
    anchor_to: 'bottom_left',
    controls: [
      { 'inventory_panel@chest.bcui_inventory_panel': {} },
      {
        'inventory_label@common.section_heading_label': {
          anchor_from: 'top_left',
          anchor_to: 'top_left',
          offset: [7, 3],
          layer: 2,
          text: 'container.inventory',
        },
      },
    ],
  },

  // Vanilla's `common.hotbar_grid_template`, cell swapped.
  bcui_hotbar_grid: {
    type: 'grid',
    size: [162, 18],
    anchor_from: 'bottom_middle',
    anchor_to: 'bottom_middle',
    offset: [0, -5],
    grid_dimensions: [9, 1],
    grid_item_template: 'chest.bcui_hotbar_item',
    collection_name: 'hotbar_items',
  },
});

/**
 * @param {object} options
 * @param {{ name: string, namespace: string, entry: string, layoutId: number }[]} options.screens
 * @param {string} options.collection
 * @param {number} options.protocolAux aux id of the marker item in slot 0
 * @param {number} options.transportOrdinal durability reading that hides a
 *   transport item in the redrawn grids; must match the runtime's
 *   `TRANSPORT_ORDINAL`
 * @returns {object} a JSON UI document in the `chest` namespace
 */
export function buildRouter({ screens, collection, protocolAux, transportOrdinal }) {
  for (const screen of screens) {
    // The two keys share the durability channel, so they must never collide: a
    // layout with the transport's reading would make the grids hide the wrong
    // item, and 2001 screens is far past the marker item's range anyway.
    if (screen.layoutId >= transportOrdinal) {
      throw new Error(
        `Layout id ${screen.layoutId} (${screen.name}) reached the transport ordinal `
        + `${transportOrdinal}; the two ride the same durability value and must not meet.`,
      );
    }
  }

  /** @type {Record<string, unknown>} */
  const document = { namespace: 'chest', ...hiddenItemGrids(protocolAux, transportOrdinal) };

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
      // Vanilla keeps its fly animation; compiled screens do without — see the
      // root panel below.
      { 'flying_item_renderer@common.flying_item_renderer': { layer: 15 } },
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
            // No flyer here: it moved into the vanilla gate. The renderer draws
            // whatever flies with no way to filter by item, and on a compiled
            // screen the most frequent flier is a button's transport on its way
            // to the hidden grids. The cost is real items from input and output
            // slots arriving without the animation.
            { 'inventory_selected_icon_button@common.inventory_selected_icon_button': {} },
            { 'gamepad_cursor@common.gamepad_cursor_button': {} },
          ],
        },
      },
    ],
  };

  return document;
}
