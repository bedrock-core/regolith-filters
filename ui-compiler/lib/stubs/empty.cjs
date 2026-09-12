// A module with nothing in it, for what this build has not written yet.
//
// An addon imports `@bedrock-core/generated/ui` to register its compiled
// screens, and that module is an output of the run reading the addon's
// declaration — so while the declaration is read there is nothing to import.
// Nothing needs it either: what the module registers is read when a screen is
// rendered, and no screen is rendered here.

module.exports = {};
