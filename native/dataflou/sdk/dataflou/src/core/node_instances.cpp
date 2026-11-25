// node_instances.cpp — this node's instances, as a source (9.1): the id an
// instance carries, given by the core (ids auto) or required of the host
// (ids source), and the calls that start and stop one.

#include "node_internal.h"
#include "dataflou/value_cast.h"

#include <cstring>

namespace dataflou {

namespace {

// A slot's id param (its template's role, or a param named "id"), nullptr if none
const ParamNode* id_param(const ParamNode* slot) {
    if (!slot) return nullptr;
    for (const auto* c : slot->children) {
        if (c->meta.kind != ParamKind::Param) continue;
        if (c->meta.role == ParamRole::Id || (c->meta.role == ParamRole::None && c->meta.name == "id")) return c;
    }
    return nullptr;
}

// The population a param of a slot belongs to, nullptr if it isn't in one
const ParamNode* population_of(const ParamNode* n) {
    const ParamNode* slot = n ? n->parent : nullptr;
    const ParamNode* pop = slot ? slot->parent : nullptr;
    return pop && pop->meta.slots > 0 ? pop : nullptr;
}

// "touch/3/on" → "touch/3", then "touch"
void parent_path(const char* path, Text& out) {
    const char* bar = std::strrchr(path, '/');
    out = bar ? Text(path, static_cast<size_t>(bar - path)) : Text();
}

double number_of(const ParamValue& v) {
    return v.tag == ParamType::Bool ? (v.b ? 1.0 : 0.0) : v.n;
}

} // namespace

// The host wrote one of its params: a slot's id, written for its instance
void Node::id_written(const ParamNode* n) {
    if (!population_of(n) || id_param(n->parent) != n) return;
    for (const auto* f : fresh_ids_)
        if (f == n) return;
    if (const ParamNode** f = fresh_ids_.emplace_back()) *f = n;
}

// Its gate fell: the next instance in that slot needs its own id
void Node::slot_ended(const ParamNode* gate) {
    const ParamNode* id = id_param(gate->parent);
    for (size_t i = 0; i < fresh_ids_.size(); ++i)
        if (fresh_ids_[i] == id) {
            fresh_ids_.erase(fresh_ids_.begin() + static_cast<ptrdiff_t>(i));
            return;
        }
}

// A gate the host raises: its slot's id, written for this instance, else the
// population's next (ids auto); false if one is required (ids source)
bool Node::give_id(const char* gate_path, const ParamNode* gate) {
    const ParamNode* pop = population_of(gate);
    const ParamNode* id = id_param(gate->parent);
    if (!pop || !id || gate->meta.flow == FlowDir::Destination) return true;
    for (const auto* f : fresh_ids_)
        if (f == id) return true;
    Text slot_path, pop_path;
    parent_path(gate_path, slot_path);
    parent_path(slot_path.c_str(), pop_path);
    if (pop->meta.ids == IdsMode::Source) {
        log("%s: no id written, the instance doesn't start (ids: source)", slot_path.c_str());
        return false;
    }
    const uint16_t pi = population_index(pop_path.c_str());
    if (pi == ParamSubscription::NONE) return true;
    ParamValue n, v;
    n.tag = ParamType::Number;
    n.n = static_cast<double>(populations_[pi].next_id++);
    if (!value_cast(n, id->meta.type, v)) return true;
    Text id_path;
    join_path(slot_path.c_str(), id->meta.name.c_str(), id_path);
    set_value(id_path.c_str(), v);
    return true;
}

uint8_t Node::start_instance(const char* population, const double* id) {
    const ParamNode* pop = local_params_.resolve(population);
    if (!pop || pop->meta.slots == 0) return 0;
    if (pop->meta.ids == IdsMode::Source && !id) {
        log("%s: start_instance needs an id (ids: source)", population);
        return 0;
    }
    // A slot's gate and id param
    auto gate_of = [&](const ParamNode* slot) -> const ParamNode* {
        for (const auto* c : slot->children)
            if (c->meta.kind == ParamKind::Param && is_gate(c)) return c;
        return nullptr;
    };
    uint8_t free_slot = 0;
    for (const auto* slot : pop->children) {
        const ParamNode* gate = gate_of(slot);
        if (!gate) continue;
        const uint8_t k = static_cast<uint8_t>(atoi(slot->meta.name.c_str()));
        if (gate->value.b) {
            // ids source: an instance already open with this id is this one
            const ParamNode* idp = id_param(slot);
            if (id && idp && number_of(idp->value) == *id) return k;
            continue;
        }
        if (!free_slot) free_slot = k;
    }
    if (!free_slot) return 0;
    char k[4];
    snprintf(k, sizeof(k), "%u", static_cast<unsigned>(free_slot));
    Text slot_path;
    join_path(population, k, slot_path);
    const ParamNode* slot = local_params_.resolve(slot_path.c_str());
    if (id) {
        if (const ParamNode* idp = id_param(slot)) {
            ParamValue n, v;
            n.tag = ParamType::Number;
            n.n = *id;
            if (value_cast(n, idp->meta.type, v)) {
                Text p;
                join_path(slot_path.c_str(), idp->meta.name.c_str(), p);
                set_value(p.c_str(), v);
            }
        }
    }
    Text gate_path;
    join_path(slot_path.c_str(), gate_of(slot)->meta.name.c_str(), gate_path);
    ParamValue on;
    on.tag = ParamType::Bool;
    on.b = true;
    set_value(gate_path.c_str(), on);
    const ParamNode* gate = local_params_.resolve(gate_path.c_str());
    return gate && gate->value.b ? free_slot : 0;
}

bool Node::stop_instance(const char* population, uint8_t slot, EndReason reason) {
    char k[4];
    snprintf(k, sizeof(k), "%u", static_cast<unsigned>(slot));
    Text slot_path;
    join_path(population, k, slot_path);
    const ParamNode* s = local_params_.resolve(slot_path.c_str());
    if (!s || !population_of(s->children.empty() ? nullptr : s->children[0])) return false;
    const ParamNode* gate = nullptr;
    for (const auto* c : s->children) {
        if (c->meta.kind != ParamKind::Param) continue;
        if (is_gate(c)) gate = c;
        else if (reason != EndReason::None && c->meta.role == ParamRole::Reason) {
            Text p;
            join_path(slot_path.c_str(), c->meta.name.c_str(), p);
            ParamValue v;
            v.tag = ParamType::String;
            v.s = to_string(reason);
            ParamValue cast;
            if (value_cast(v, c->meta.type, cast)) set_value(p.c_str(), cast);
            else if (c->meta.type == ParamType::Number) {
                v.tag = ParamType::Number;
                v.n = static_cast<double>(reason);
                set_value(p.c_str(), v);
            }
        }
    }
    if (!gate || !gate->value.b) return false;
    Text gate_path;
    join_path(slot_path.c_str(), gate->meta.name.c_str(), gate_path);
    ParamValue off;
    off.tag = ParamType::Bool;
    off.b = false;
    set_value(gate_path.c_str(), off);
    return true;
}

} // namespace dataflou
