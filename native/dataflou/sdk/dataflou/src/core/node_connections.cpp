// node_connections.cpp — connections as a destination keeps them (9.1,
// connection.h): the registry, the links each makes from the two trees, the
// params' view of them and the streams they ask for; made, undone, asked of
// another node, said to the mesh (CONNS).

#include "node_internal.h"

namespace dataflou {

// --- connection.h ---

bool Curve::operator==(const Curve& o) const {
    if (n != o.n || free != o.free) return false;
    for (uint8_t i = 0; i < n; ++i)
        if (x[i] != o.x[i] || y[i] != o.y[i]) return false;
    return true;
}

bool LinkAxis::operator==(const LinkAxis& o) const {
    return in_set == o.in_set && out_set == o.out_set && curve == o.curve &&
           (!in_set || (in_min == o.in_min && in_max == o.in_max)) &&
           (!out_set || (out_min == o.out_min && out_max == o.out_max));
}

bool Link::plain() const {
    for (const auto& a : axes)
        if (!a.plain()) return false;
    return true;
}

bool Link::operator==(const Link& o) const {
    if (dest != o.dest || source != o.source || chosen != o.chosen) return false;
    if (plain() && o.plain()) return true;
    return axes == o.axes;
}

Link* Connection::link_to(const char* rel) {
    for (auto& l : links)
        if (l.dest == rel) return &l;
    return nullptr;
}

const Link* Connection::link_to(const char* rel) const {
    for (const auto& l : links)
        if (l.dest == rel) return &l;
    return nullptr;
}

bool Connection::operator==(const Connection& o) const {
    return id == o.id && dest == o.dest && source_sku == o.source_sku && source == o.source &&
           poly == o.poly && pick == o.pick && links == o.links;
}

void join_path(const char* a, const char* b, Text& out) {
    if (!a || !*a) { out = b ? b : ""; return; }
    out = a;
    if (b && *b) { out += "/"; out += b; }
}

// --- The trees ---

namespace {

template <typename N>
const N* child_named(const N* n, const char* name) {
    if (!n) return nullptr;
    for (const auto* c : n->children)
        if (c->meta.name == name) return c;
    return nullptr;
}

// f(rel, param) for every param under a group, depth first
template <typename N, typename F>
void each_param(const N* group, const char* prefix, F&& f) {
    for (const auto* c : group->children) {
        Text rel;
        join_path(prefix, c->meta.name.c_str(), rel);
        if (c->meta.kind == ParamKind::Param) { f(rel, c); continue; }
        if (c->meta.slots > 0) {                      // a population within: its template, as "*"
            Text star;
            join_path(rel.c_str(), "*", star);
            for (const auto* t : c->children)
                if (t->meta.name == "1") each_param(t, star.c_str(), f);
            continue;
        }
        each_param(c, rel.c_str(), f);
    }
}

// Down a template by a link's path: "*" steps into a population's template
// (its slot 1). nullptr if the path doesn't lead to that kind of thing.
template <typename N>
const N* follow(const N* at, const char* rel) {
    const char* r = rel;
    while (at && *r) {
        const char* slash = std::strchr(r, '/');
        const size_t len = slash ? static_cast<size_t>(slash - r) : std::strlen(r);
        if (len == 1 && *r == '*') {
            if (at->meta.kind != ParamKind::Group || at->meta.slots == 0) return nullptr;
            at = child_named(at, "1");
        } else {
            Text part(r, len);
            at = child_named(at, part.c_str());
        }
        r = slash ? slash + 1 : r + len;
    }
    return at;
}

// "a/*/b/*/c" -> "a/*/b/*/" and "c" (the part above its innermost
// population, the param under it)
void split_last_level(const Text& rel, Text& above, Text& under) {
    const char* s = rel.c_str();
    const char* last = nullptr;
    for (const char* p = s; (p = std::strstr(p, "*/")) != nullptr; p += 2)
        if (p == s || p[-1] == '/') last = p;
    if (!last) { above.clear(); under = rel; return; }
    above.assign(s, static_cast<size_t>(last - s) + 2);
    under = last + 2;
}

// A connection's end in a tree: its path, or through its "*" level (a
// picked instance) the population's template
template <typename Store>
auto end_of(const Store& store, const char* path) {
    using N = std::remove_cv_t<std::remove_pointer_t<decltype(store.root())>>;
    const N* n = std::strchr(path, '*') ? follow<N>(store.root(), path) : store.resolve(path);
    size_t element = 0;
    if (!n) n = resolve_element(store, path, element);   // one element of an array: the array (9.3)
    return n;
}

// "touch/*/xy" -> "touch" and "xy": the population a picked connection
// takes an instance of, and the path within the instance
bool split_pick(const Text& source, Text& pop, Text& within) {
    const char* s = source.c_str();
    const char* star = std::strstr(s, "/*");
    if (!star || (star[2] != '/' && star[2] != 0) || std::strstr(star + 2, "*")) return false;
    pop.assign(s, static_cast<size_t>(star - s));
    within = star[2] ? star + 3 : "";
    return true;
}

template <typename N>
bool is_population(const N* n) { return n && n->meta.kind == ParamKind::Group && n->meta.slots > 0; }

// A param's part in a population's template: its role, or by its name
// when none is said (a bool "on" is the gate, "id" the id)
template <typename N>
ParamRole role_of(const N* n) {
    if (n->meta.role != ParamRole::None) return n->meta.role;
    if (n->meta.name == "on" && n->meta.type == ParamType::Bool) return ParamRole::Gate;
    if (n->meta.name == "id") return ParamRole::Id;
    return ParamRole::None;
}

// The source param with that role in a template (not in a population
// within it: that one has its own), nullptr if none
template <typename N>
const N* with_role(const N* group, ParamRole r) {
    for (const auto* c : group->children) {
        if (c->meta.kind != ParamKind::Param) {
            if (c->meta.slots > 0) continue;
            if (const N* x = with_role(c, r)) return x;
            continue;
        }
        if (role_of(c) == r) return c;
    }
    return nullptr;
}

template <typename N>
void rel_path(const N* n, const N* top, Text& out) {
    if (!n || n == top) { out.clear(); return; }
    Text up;
    rel_path(n->parent, top, up);
    join_path(up.c_str(), n->meta.name.c_str(), out);
}

bool takes_values(const ParamNode* n) {
    return n->meta.kind == ParamKind::Param &&
           (n->meta.flow == FlowDir::Destination || n->meta.flow == FlowDir::Bidir);
}

// The links a connection makes, from the two trees. `src` is the source's
// end, nullptr when unknown: a tree we don't hold (yet), or an end that
// isn't there; then the links stay as last made, as they do when the
// destination's end isn't there. Links chosen by hand stay as they are;
// the others pair params by name, keeping their transforms.
template <typename S>
void derive_links(Connection& c, const ParamNode* dest, const S* src, bool src_known) {
    if (!dest) return;
    if (dest->meta.kind == ParamKind::Param) {
        if (src_known && src && src->meta.kind != ParamKind::Param) { c.links.clear(); return; }
        Vector<Link> links;
        Link* l = links.emplace_back();
        if (!l) return;
        if (const Link* was = c.link_to("")) *l = *was;
        l->dest = "";
        if (!l->chosen) l->source = "";
        c.poly = false;
        c.links = std::move(links);
        return;
    }
    if (!src_known || !src) return;
    if (src->meta.kind != ParamKind::Group) { c.links.clear(); return; }
    c.poly = is_population(dest) && is_population(src);
    const ParamNode* d = c.poly ? child_named(dest, "1") : dest;
    const S* s = c.poly ? child_named(src, "1") : src;
    if (!d || !s) return;
    Vector<Link> links;
    each_param(d, "", [&](const Text& rel, const ParamNode* p) {
        if (!takes_values(p)) return;
        const Link* was = c.link_to(rel.c_str());
        if (was && was->chosen) { links.push_back(*was); return; }
        // The same name on the source side: a param (any type: the value is
        // cast), through the same populations
        const S* at = follow(s, rel.c_str());
        Text from = rel;
        if (!at || at->meta.kind != ParamKind::Param) {
            // In a population, a gate goes to the gate and an id to the id
            // (each role), whatever their names
            Text above, under;
            split_last_level(rel, above, under);
            const bool in_population = c.poly || !above.empty();
            const ParamRole r = in_population ? role_of(p) : ParamRole::None;
            const S* level = above.empty() ? s : follow(s, Text(above.c_str(), above.size() - 1).c_str());
            at = r != ParamRole::None && level ? with_role(level, r) : nullptr;
            if (!at) return;
            Text tail;
            rel_path(at, level, tail);
            join_path(Text(above.c_str(), above.empty() ? 0 : above.size() - 1).c_str(), tail.c_str(), from);
        }
        Link* l = links.emplace_back();
        if (!l) return;
        if (was) l->axes = was->axes;
        l->dest = rel;
        l->source = from;
    });
    c.links = std::move(links);
}

// f(dest param path, source param path, link index) for each link a
// connection feeds: one per link, or for a population one per link and
// slot the two ends share (slot k to slot k, until allocation)
template <typename F>
void each_leaf(const Connection& c, uint8_t dest_slots, uint8_t source_slots, F&& f) {
    for (size_t li = 0; li < c.links.size(); ++li) {
        const Link& l = c.links[li];
        if (l.chosen && l.source.empty()) continue;            // left unfed
        if (std::strstr(l.dest.c_str(), "*")) continue;        // into a population within: allocated
        if (!c.poly) {
            Text d, s;
            join_path(c.dest.c_str(), l.dest.c_str(), d);
            join_path(c.source.c_str(), l.source.c_str(), s);
            f(d, s, li);
            continue;
        }
        const uint8_t n = std::min(dest_slots, source_slots);
        for (uint8_t k = 1; k <= n; ++k) {
            char slot[4];
            snprintf(slot, sizeof(slot), "%u", static_cast<unsigned>(k));
            Text dg, sg, d, s;
            join_path(c.dest.c_str(), slot, dg);
            join_path(c.source.c_str(), slot, sg);
            join_path(dg.c_str(), l.dest.c_str(), d);
            join_path(sg.c_str(), l.source.c_str(), s);
            f(d, s, li);
        }
    }
}

template <typename N>
void clear_subscriptions(N* node) {
    node->subscriptions.clear();
    for (auto* c : node->children) clear_subscriptions(c);
}

template <typename Store>
uint8_t slots_of(const Store& store, const char* path) {
    const auto* n = store.resolve(path);
    return n ? n->meta.slots : 0;
}

} // namespace

// --- The registry ---

ConnectionId Node::next_connection_id() {
    const SceneStamp st = next_scene_stamp();       // the clock is kept with the scenes
    scenes_dirty_ = true;                           // at the next persist, not now
    ConnectionId id;
    id.counter = st.counter;
    id.origin  = st.origin;
    return id;
}

Connection* Node::find_connection(const ConnectionId& id) {
    if (id.empty()) return nullptr;
    for (auto& c : connections_)
        if (c.id == id) return &c;
    return nullptr;
}

Connection* Node::find_connection(const char* dest, const char* sku, const char* source) {
    for (auto& c : connections_)
        if (c.same_ends(dest, sku, source)) return &c;
    return nullptr;
}

// A connection by its ends, or the one whose link joins them
ConnectionId Node::connection_id(const char* dest_path, const char* source_sku,
                                 const char* source_path) const {
    for (const auto& c : connections_)
        if (c.same_ends(dest_path, source_sku, source_path)) return c.id;
    if (const ParamNode* n = local_params_.resolve(dest_path))
        for (const auto& s : n->subscriptions)
            if (s.source_sku == source_sku && s.source_path == source_path) return s.id;
    return {};
}

SourceShape Node::source_shape(const char* dest_path, const char* source_sku,
                               const char* source_path) const {
    for (const auto& ie : inbound_stream_)
        if (ie.local_path == dest_path && ie.source_sku == source_sku && ie.source_path == source_path)
            return ie.shape;
    return {};
}

void Node::listeners(const char* local_path, ListenerCb cb, void* ctx) const {
    if (!local_path || !cb) return;
    for (size_t i = 0; i < stream_targets_.size(); ++i) {
        const auto& t = stream_targets_[i];
        if (t.monitor || t.local_path != local_path) continue;
        bool said = false;
        for (size_t j = 0; j < i && !said; ++j) {
            const auto& o = stream_targets_[j];
            said = !o.monitor && o.local_path == t.local_path && o.dest_sku == t.dest_sku &&
                   o.dest_path == t.dest_path;
        }
        if (!said) cb(t.dest_sku.c_str(), t.dest_path.c_str(), ctx);
    }
}

void Node::streamed(StreamedCb cb, void* ctx) const {
    if (!cb) return;
    for (const auto& t : stream_targets_)
        if (t.local_node) cb(t.local_node, t.monitor, ctx);
}

void Node::relink(EndOrigin origin, bool changed) {
    if (relinking_) return;      // a change it makes (a scene's status) comes back here
    relinking_ = true;
    // 1. Links, from the trees as they are now
    for (auto& c : connections_) {
        const ParamNode* dest = local_params_.resolve(c.dest.c_str());
        Connection before = c;
        if (c.source_sku == identity_.sku) {
            derive_links(c, dest, end_of(local_params_, c.source.c_str()), true);
        } else {
            const NodeEntry* e = world_.find_node(c.source_sku.c_str());
            const bool known = e && !e->params.root()->children.empty();
            derive_links(c, dest, known ? end_of(e->params, c.source.c_str()) : nullptr, known);
        }
        changed = changed || c != before;
    }

    // 2. The params' view: each destination param, what feeds it. Between
    // populations, which slot is fed is the allocation's: no param's own.
    clear_subscriptions(local_params_.root());
    for (size_t ci = 0; ci < connections_.size(); ++ci) {
        const Connection& c = connections_[ci];
        if (c.poly) continue;
        const uint8_t ds = slots_of(local_params_, c.dest.c_str());
        uint8_t ss = ds;
        if (c.source_sku == identity_.sku) ss = slots_of(local_params_, c.source.c_str());
        else if (const NodeEntry* e = world_.find_node(c.source_sku.c_str()))
            if (const auto* n = e->params.resolve(c.source.c_str())) ss = n->meta.slots;
        each_leaf(c, ds, ss, [&](const Text& d, const Text& s, size_t li) {
            ParamNode* p = local_params_.resolve(d.c_str());
            if (!p || !takes_values(p)) return;
            for (const auto& x : p->subscriptions)
                if (x.source_sku == c.source_sku && x.source_path == s) return;   // fed already
            ParamSubscription sub;
            sub.source_sku = c.source_sku;
            sub.source_path = s;
            sub.id = c.id;
            sub.conn = static_cast<uint16_t>(ci);
            sub.link = static_cast<uint16_t>(li);
            if (!p->subscriptions.push_back(sub))
                log("Out of memory: %s from %s/%s will not be received",
                    d.c_str(), c.source_sku.c_str(), s.c_str());
        });
    }

    // 3. Streams: ask for the new ones, stop the ones gone
    Vector<InboundEntry> was = inbound_stream_;
    rebuild_inbound_stream();
    auto same = [](const InboundEntry& a, const InboundEntry& b) {
        return a.source_sku == b.source_sku && a.source_path == b.source_path &&
               a.local_path == b.local_path;
    };
    for (const auto& old : was) {
        bool kept = false;
        for (const auto& ie : inbound_stream_) kept = kept || same(old, ie);
        if (kept) continue;
        if (old.source_sku == identity_.sku) {
            for (size_t i = 0; i < stream_targets_.size(); ++i) {
                const auto& t = stream_targets_[i];
                if (t.dest_sku == identity_.sku && t.local_path == old.source_path &&
                    t.dest_path == old.local_path) {
                    stream_targets_.erase(stream_targets_.begin() + static_cast<ptrdiff_t>(i));
                    break;
                }
            }
        } else {
            send_stream_stop(old.source_sku.c_str(), old.source_path.c_str(), old.local_path.c_str());
        }
        PendingEnd* e = ends_pending_.emplace_back();
        if (e) { e->path = old.local_path; e->origin = origin; }
        forget_stream_name(old.sid);
    }
    for (auto& ie : inbound_stream_) {
        const InboundEntry* had = nullptr;
        for (const auto& old : was)
            if (same(old, ie)) had = &old;
        if (had) {
            ie.sid = had->sid;
            ie.shape = had->shape;
            ie.contributes = had->contributes;      // its part in a merge (9.3)
            ie.leaves_at = had->leaves_at;          // and its grace, its source lost
            ie.last = had->last;
            ie.last_elems = had->last_elems;
            continue;
        }
        ie.sid = new_inbound_sid(&was);
        if (!ie.sid) log("No stream number left: %s will not be fed", ie.local_path.c_str());
        // We know from the start what its packets feed
        else if (!name_stream(ie.source_sku.c_str(), ie.sid, ie.source_path, ie.local_path))
            log("Out of memory: %s will not be fed from %s", ie.local_path.c_str(), ie.source_path.c_str());
        if (ie.source_sku == identity_.sku) {
            ParamNode* src_node = local_params_.resolve(ie.source_path.c_str());
            size_t element = 0;
            int32_t element_at = -1;
            if (!src_node && (src_node = resolve_element(local_params_, ie.source_path.c_str(), element)))
                element_at = static_cast<int32_t>(element);   // one element of an array (9.3)
            if (src_node && src_node->meta.kind == ParamKind::Param && !readable(src_node->meta.access)) {
                log("Not fed: %s is write-only", ie.source_path.c_str());
            } else if (src_node && src_node->meta.kind == ParamKind::Param) {
                StreamTarget st;
                st.dest_sku = identity_.sku;
                st.dest_address = "127.0.0.1";
                st.dest_udp_port = listen_port_ + 1;
                st.local_path = ie.source_path;
                st.dest_path = ie.local_path;
                st.local_node = src_node;
                st.element = element_at;
                st.rate_hz = src_node->meta.rate;
                st.id = ie.sid;
                st.conn = ie.id;
                st.last_epoch = src_node->change_epoch - 1;   // the current value, once
                if (!stream_targets_.push_back(st))
                    log("Out of memory: %s will not be fed from %s", ie.local_path.c_str(),
                        ie.source_path.c_str());
            }
        } else {
            send_stream_request(ie);
        }
        if (ie.local_node) settle_destination(ie.local_node, ie.local_path.c_str(), EndOrigin::None);
    }
    // Instances of a connection that went (or no longer joins populations) end
    for (auto& p : populations_)
        for (size_t j = 0; j < p.slots.size(); ++j) {
            const Holder& h = p.slots[j];
            if (!h.open || h.host) continue;
            const Connection* c = find_connection(h.conn);
            if (!c || !c->poly || !(c->dest == p.path))
                close_slot(p, static_cast<uint8_t>(j + 1), origin, EndReason::Cancel, true);
        }
    // Ours, as the world view shows them
    if (auto* self = world_.find_node(identity_.sku.c_str())) {
        mirror_own_tree(*self);
        self->connections = connections_;
        self->conn_version = conn_version_;
    }
    ++world_gen_;
    if (changed) connections_changed();
    relinking_ = false;
}

void Node::connections_changed() {
    ++conn_version_;
    conns_dirty_ = true;
    if (auto* self = world_.find_node(identity_.sku.c_str())) {
        self->connections = connections_;
        self->conn_version = conn_version_;
        for (auto& peer : peers_)
            if (peer.socket != INVALID_SOCKET_HANDLE && peer.hello_received &&
                peer.role != NodeRole::Source)
                send_connections(peer, *self);
    }
    topology_changed();
    scene_touched();
}

void Node::send_connections(PeerConnection& peer, const NodeEntry& about) {
    MsgConns msg;
    msg.about_sku = about.identity.sku;
    msg.version = about.conn_version;
    msg.list = about.connections;
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_conns(buf, ++seq_, msg); });
    if (len == 0) {
        log("CONNS about %s: too big to send (%u connections)", about.identity.sku.c_str(),
            static_cast<unsigned>(about.connections.size()));
        return;
    }
    if (!fits(peer, len, "CONNS")) return;
    send_framed(peer.socket, etl::span<const uint8_t>(encode_buf_.data(), len));
}

// Another node's params, as its connections feed them
void Node::expand_connections(NodeEntry& entry) {
    clear_subscriptions(entry.params.root());
    for (const auto& c : entry.connections) {
        if (c.poly) continue;                          // which slot: the destination's to say
        const uint8_t ds = slots_of(entry.params, c.dest.c_str());
        uint8_t ss = ds;
        if (const NodeEntry* src = world_.find_node(c.source_sku.c_str()))
            if (const auto* n = src->params.resolve(c.source.c_str())) ss = n->meta.slots;
        each_leaf(c, ds, ss, [&](const Text& d, const Text& s, size_t) {
            WorldParamNode* p = entry.params.resolve(d.c_str());
            if (!p || p->meta.kind != ParamKind::Param) return;
            ParamSubscription sub;
            sub.source_sku = c.source_sku;
            sub.source_path = s;
            sub.id = c.id;
            p->subscriptions.push_back(sub);   // out of memory: not shown
        });
    }
}

bool Node::unsubscribe_id(const ConnectionId& id, EndOrigin origin) {
    const Connection* c = find_connection(id);
    if (!c) return false;
    const Text dest = c->dest;
    const etl::string<36> sku = c->source_sku;
    const Text src = c->source;
    return unsubscribe(dest.c_str(), sku.c_str(), src.c_str(), origin);
}

bool Node::subscribe(const char* local_path, const char* source_sku, const char* source_path,
                     ConnectionId id, const Pick& pick) {
    ParamNode* node = local_params_.resolve(local_path);
    if (!node) return false;
    if (node->meta.kind == ParamKind::Param && !takes_values(node)) return false;
    // An instance picked: one "*" level in the source, to a plain group or param
    {
        Text pop, within;
        const bool starred = std::strchr(source_path, '*') != nullptr;
        if (starred != pick.any()) return false;
        if (starred && (!split_pick(Text(source_path), pop, within) || is_population(node) ||
                        (pick.kind == Pick::Rank && pick.value == 0)))
            return false;
    }
    // A group listens to a group, a param to a param (when we know the source)
    if (identity_.sku == source_sku) {
        const ParamNode* s = end_of(local_params_, source_path);
        if (!s || s->meta.kind != node->meta.kind) return false;
    } else if (const NodeEntry* e = world_.find_node(source_sku)) {
        const auto* s = end_of(e->params, source_path);
        if (s && s->meta.kind != node->meta.kind) return false;
    }
    if (Connection* was = find_connection(local_path, source_sku, source_path)) {   // there already
        if (was->pick != pick) {                          // another instance
            was->pick = pick;
            log("Connection %s <- %s/%s picks again", local_path, source_sku, source_path);
            relink(EndOrigin::Connection, true);
        }
        return true;
    }

    Connection c;
    c.id = id.empty() ? next_connection_id() : id;
    c.dest = local_path;
    c.source_sku = source_sku;
    c.source = source_path;
    c.pick = pick;
    if (!connections_.push_back(std::move(c))) {
        log("Out of memory: %s <- %s/%s not made", local_path, source_sku, source_path);
        return false;
    }
    // In presentation the source may be a node we didn't keep a link to
    if (phase() == Phase::Presentation && identity_.sku != source_sku && !connected_to(source_sku))
        mdns_.browse("_dataflou._tcp.local.");
    // A satellite kept only the identity of a node it did not listen to: now it
    // does, so take its next DECLARE in full (its tree gives the links, and the
    // source's range for normalizing what arrives).
    if (role_ == NodeRole::Satellite) {
        if (auto* src = world_.find_node(source_sku)) {
            if (!src->is_local && !src->params.root()->children.size()) src->decl_version = 0;
        }
    }
    log("Connected %s <- %s/%s", local_path, source_sku, source_path);
    relink(EndOrigin::Connection, true);
    return true;
}

bool Node::unsubscribe(const char* local_path, const char* source_sku, const char* source_path,
                       EndOrigin origin) {
    bool found = false;
    for (size_t i = 0; i < connections_.size(); ++i) {
        if (!connections_[i].same_ends(local_path, source_sku, source_path)) continue;
        connections_.erase(connections_.begin() + static_cast<ptrdiff_t>(i));
        found = true;
        break;
    }
    if (!found) {
        // One link of a group connection: it is left unfed, the rest stays
        const ParamNode* n = local_params_.resolve(local_path);
        if (!n) return false;
        for (const auto& s : n->subscriptions) {
            if (s.source_sku != source_sku || s.source_path != source_path ||
                s.conn >= connections_.size()) continue;
            Connection& c = connections_[s.conn];
            if (s.link >= c.links.size()) break;
            Link& l = c.links[s.link];
            l.chosen = true;
            l.source.clear();
            found = true;
            break;
        }
        if (!found) return false;
    }
    log("Disconnected %s <- %s/%s", local_path, source_sku, source_path);

    // A satellite keeps the params only of the nodes it listens to
    if (role_ == NodeRole::Satellite && identity_.sku != source_sku && !listens_to(source_sku)) {
        if (NodeEntry* e = world_.find_node(source_sku); e && !e->is_local) {
            e->params.clear();
            ++world_gen_;
        }
    }
    relink(origin, true);
    return true;
}

bool Node::edit_link(const ConnectionId& id, const Link& link, uint8_t what) {
    Connection* c = find_connection(id);
    if (!c) return false;
    Link* l = c->link_to(link.dest.c_str());
    if (what & LinkReset) {
        if (l) l->chosen = false;               // matched by name again at the relink
    }
    if (what & LinkSource) {
        if (!l) {
            l = c->links.emplace_back();
            if (!l) return false;
            l->dest = link.dest;
        }
        l->chosen = true;
        l->source = link.source;
    }
    if (what & LinkTransform) {
        if (!l) return false;
        l->axes = link.axes;
    }
    log("Link %s of %s <- %s/%s edited", link.dest.empty() ? "(param)" : link.dest.c_str(),
        c->dest.c_str(), c->source_sku.c_str(), c->source.c_str());
    relink(EndOrigin::Connection, true);
    return true;
}

expected<void, Error> Node::edit_link_remote(const char* dest_sku, const ConnectionId& id,
                                             const Link& link, uint8_t what) {
    if (identity_.sku == dest_sku)
        return edit_link(id, link, what) ? expected<void, Error>{} : unexpected<Error>(Error::NotFound);
    auto* peer = find_peer_by_sku(dest_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE)
        return unexpected<Error>(Error::NotConnected);
    MsgLinkEdit m;
    m.dest_sku = dest_sku;
    m.id = id;
    m.link = link;
    m.what = what;
    const size_t len = encode([&](etl::span<uint8_t> buf) {
        return encode_link_edit(buf, ++seq_, m); });
    if (len == 0) return unexpected<Error>(Error::Full);
    send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    return {};
}

// --- Remote subscriptions ---

expected<void, Error> Node::subscribe_remote(const char* dest_sku, const char* dest_path,
                                                   const char* source_sku, const char* source_path,
                                                   const Pick& pick) {
    // The connection is made here, by us: its id is ours
    const ConnectionId id = next_connection_id();
    if (identity_.sku == dest_sku) {
        return subscribe(dest_path, source_sku, source_path, id, pick)
            ? expected<void, Error>{}
            : unexpected<Error>(Error::NotFound);
    }
    auto* peer = find_peer_by_sku(dest_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE)
        return unexpected<Error>(Error::NotConnected);

    MsgSubRequest sr;
    sr.subscribe = true;
    sr.dest_sku = dest_sku;
    sr.dest_path = dest_path;
    sr.source_sku = source_sku;
    sr.source_path = source_path;
    sr.id = id;
    sr.pick = pick;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_sub_request(buf,
                                     ++seq_, sr); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Forwarded subscribe to %s: %s <- %s/%s", dest_sku, dest_path, source_sku, source_path);
    }
    return {};
}

expected<void, Error> Node::unsubscribe_remote(const char* dest_sku, const char* dest_path,
                                                     const char* source_sku, const char* source_path) {
    if (identity_.sku == dest_sku) {
        return unsubscribe(dest_path, source_sku, source_path, EndOrigin::Outside)
            ? expected<void, Error>{}
            : unexpected<Error>(Error::NotFound);
    }
    auto* peer = find_peer_by_sku(dest_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE)
        return unexpected<Error>(Error::NotConnected);

    MsgSubRequest sr;
    sr.subscribe = false;
    sr.dest_sku = dest_sku;
    sr.dest_path = dest_path;
    sr.source_sku = source_sku;
    sr.source_path = source_path;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_sub_request(buf,
                                     ++seq_, sr); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Forwarded unsubscribe to %s: %s <- %s/%s", dest_sku, dest_path, source_sku, source_path);
    }
    return {};
}

expected<void, Error> Node::unsubscribe_remote_id(const char* dest_sku, const ConnectionId& id) {
    if (identity_.sku == dest_sku)
        return unsubscribe_id(id, EndOrigin::Outside) ? expected<void, Error>{}
                                                      : unexpected<Error>(Error::NotFound);
    auto* peer = find_peer_by_sku(dest_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE)
        return unexpected<Error>(Error::NotConnected);
    MsgSubRequest sr;
    sr.subscribe = false;
    sr.dest_sku = dest_sku;
    sr.id = id;
    const size_t len = encode([&](etl::span<uint8_t> buf) { return encode_sub_request(buf,
                                     ++seq_, sr); });
    if (len == 0) return unexpected<Error>(Error::Full);
    send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
    return {};
}

expected<void, Error> Node::set_value_remote(const char* target_sku, const char* path, const ParamValue& val) {
    if (identity_.sku == target_sku) {
        // A set from outside (the visualizer, a host's set_remote), aimed at
        // us: refused on a read param, as one from a peer would be (an
        // element of an array is its array's, 9.3)
        size_t element = 0;
        const ParamNode* n = local_params_.resolve(path);
        if (!n) n = resolve_element(local_params_, path, element);
        if (n && n->meta.kind == ParamKind::Param && n->meta.access == Access::Read) {
            log("SetValue: %s refused, it is read-only", path);
            return unexpected<Error>(Error::ReadOnly);
        }
        set_value(path, val);
        return {};
    }
    auto* peer = find_peer_by_sku(target_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE)
        return unexpected<Error>(Error::NotConnected);

    MsgSetValue sv;
    sv.target_sku = target_sku;
    sv.path = path;
    sv.value = val;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_set_value(buf,
                                   ++seq_, sv); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        log("Forwarded set_value to %s: %s", target_sku, path);
    }
    return {};
}

// --- Stream request helpers ---

void Node::send_stream_request(const InboundEntry& ie, bool quiet) {
    send_stream_request(ie.source_sku.c_str(), ie.source_path.c_str(), ie.local_path.c_str(),
                        ie.local_node ? ie.local_node->meta.rate : 0.0f, quiet, ie.sid, ie.id);
}

void Node::send_stream_request(const char* source_sku, const char* source_path,
                               const char* local_path, float rate_hz, bool quiet,
                               uint16_t stream_id, const ConnectionId& conn) {
    auto* peer = find_peer_by_sku(source_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE) {
        if (!quiet) log("send_stream_request: peer %s not connected (will retry on reconnect)", source_sku);
        return;
    }

    MsgStreamRequest msg;
    msg.source_path = source_path;
    msg.dest_path = local_path;
    msg.dest_sku = identity_.sku;
    msg.dest_udp_port = listen_port_ + 1;
    msg.rate_hz = rate_hz;
    msg.stream_id = stream_id;
    msg.conn = conn;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_stream_request(buf,
                                        ++seq_, msg); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        if (!quiet) {
            log("Sent StreamRequest to %s: %s -> %s (rate=%.1f)",
                source_sku, source_path, local_path, rate_hz);
        }
    }
}

void Node::send_stream_stop(const char* source_sku, const char* source_path,
                             const char* local_path, bool quiet) {
    auto* peer = find_peer_by_sku(source_sku);
    if (!peer || peer->socket == INVALID_SOCKET_HANDLE) {
        if (!quiet) log("send_stream_stop: peer %s not connected", source_sku);
        return;
    }

    MsgStreamStop msg;
    msg.source_path = source_path;
    msg.dest_path = local_path;
    msg.dest_sku = identity_.sku;

    size_t len = encode([&](etl::span<uint8_t> buf) { return encode_stream_stop(buf,
                                     ++seq_, msg); });
    if (len > 0) {
        send_framed(peer->socket, etl::span<const uint8_t>(encode_buf_.data(), len));
        if (!quiet) log("Sent StreamStop to %s: %s -> %s", source_sku, source_path, local_path);
    }
}

void Node::resend_stream_requests_for_peer(const char* peer_sku) {
    for (const auto& ie : inbound_stream_)
        if (ie.source_sku == peer_sku) send_stream_request(ie);
    // And the visualizer's monitors of it, as at a keepalive: a node back on
    // a new connection before the old one was found dead (restarted, its
    // stream targets gone) stays online with the same params, so
    // poll_monitors has nothing new to ask until the next keepalive
    for (auto& m : monitors_)
        if (m.sid && m.sku == peer_sku) {
            send_stream_request(m.sku.c_str(), m.path.c_str(), "", MONITOR_RATE_HZ, true, m.sid);
            m.waiting = true;
        }
}

// A peer declared itself: the monitors of its params that no value has
// answered since they were asked are asked again. A host back after a
// restart (a Max patch making its boxes) declares its params after its
// HELLO: the request sent then was dropped, and its params were already in
// our view of it, so poll_monitors has nothing new to ask until the
// keepalive (15 s).
void Node::ask_waiting_monitors(const char* peer_sku) {
    const NodeEntry* e = world_.find_node(peer_sku);
    if (!e) return;
    for (const auto& m : monitors_)
        if (m.sid && m.waiting && m.sku == peer_sku && e->params.resolve(m.path.c_str()))
            send_stream_request(m.sku.c_str(), m.path.c_str(), "", MONITOR_RATE_HZ, true, m.sid);
}

// --- Inbound stream rebuild ---

void Node::walk_inbound_recurse(const ParamNode* node, const char* path_prefix) {
    for (size_t i = 0; i < node->children.size(); ++i) {
        ParamNode* child = const_cast<ParamNode*>(node->children[i]);

        Text path;
        join_path(path_prefix, child->meta.name.c_str(), path);

        for (const auto& sub : child->subscriptions) {
            // A picked instance's: its streams are the slots' (rebuild_inbound_stream)
            if (sub.conn < connections_.size() && connections_[sub.conn].pick.any()) continue;
            InboundEntry ie;
            ie.source_sku_hash = crc32_sku(sub.source_sku.c_str());
            ie.source_sku = sub.source_sku;
            ie.source_path = sub.source_path;
            ie.id = sub.id;
            ie.local_path = path;
            ie.local_node = child;
            ie.conn = sub.conn;
            ie.link = sub.link;
            if (!inbound_stream_.push_back(ie))
                log("Out of memory: %s from %s/%s will not be received",
                    path.c_str(), sub.source_sku.c_str(), sub.source_path.c_str());
        }

        if (child->children.size() > 0) {
            walk_inbound_recurse(child, path.c_str());
        }
    }
}

namespace {

// Every chain of source slots a link into populations crosses, outermost
// first: f(chain, levels, concrete source path, concrete source population)
template <typename S, typename F>
void each_chain(const S* base, const char* base_path, bool poly, const Text& rel, F&& f) {
    Text parts[6];
    uint8_t n = 0;
    {
        Text cur;
        const char* p = rel.c_str();
        while (*p && n + 1 < 6) {
            const char* slash = std::strchr(p, '/');
            const size_t len = slash ? static_cast<size_t>(slash - p) : std::strlen(p);
            if (len == 1 && *p == '*') { parts[n++] = cur; cur.clear(); }
            else {
                Text comp(p, len), joined;
                join_path(cur.c_str(), comp.c_str(), joined);
                cur = joined;
            }
            p = slash ? slash + 1 : p + len;
        }
        parts[n++] = cur;
    }
    uint8_t chain[4] = {};
    const uint8_t levels = static_cast<uint8_t>((poly ? 1 : 0) + (n - 1));
    if (levels == 0 || levels > 4) return;
    struct Walk {
        static void go(const S* at, const Text& path, uint8_t level, uint8_t part, bool top, uint8_t levels,
                       const Text* parts, uint8_t* chain, F& f) {
            const S* pop = at;
            Text pop_path = path;
            if (!top) {
                pop = follow(at, parts[part].c_str());
                join_path(path.c_str(), parts[part].c_str(), pop_path);
                ++part;
            }
            if (!pop || pop->meta.kind != ParamKind::Group || pop->meta.slots == 0) return;
            for (uint8_t k = 1; k <= pop->meta.slots; ++k) {
                char slot[4];
                snprintf(slot, sizeof(slot), "%u", static_cast<unsigned>(k));
                const S* inside = child_named(pop, slot);
                if (!inside) continue;
                Text at_slot;
                join_path(pop_path.c_str(), slot, at_slot);
                chain[level] = k;
                if (level + 1 == levels) {
                    Text leaf;
                    join_path(at_slot.c_str(), parts[part].c_str(), leaf);
                    f(chain, levels, leaf, pop_path);
                } else {
                    go(inside, at_slot, static_cast<uint8_t>(level + 1), part, false, levels, parts, chain, f);
                }
            }
        }
    };
    Walk::go(base, Text(base_path), 0, 0, poly, levels, parts, chain, f);
}

} // namespace

void Node::rebuild_inbound_stream() {
    inbound_stream_.clear();
    walk_inbound_recurse(local_params_.root(), "");
    // Into populations: each link of each chain of source slots, the slots
    // it feeds left to the allocation, level by level
    for (size_t ci = 0; ci < connections_.size(); ++ci) {
        const Connection& c = connections_[ci];
        for (size_t li = 0; li < c.links.size(); ++li) {
            const Link& l = c.links[li];
            if (l.chosen && l.source.empty()) continue;
            if (!c.poly && !std::strstr(l.dest.c_str(), "*")) continue;   // an ordinary link
            // Its destination param, in the templates (for its role)
            Text tpl;
            {
                Text rel = l.dest;
                Text with_ones;
                const char* p = rel.c_str();
                while (*p) {
                    const char* slash = std::strchr(p, '/');
                    const size_t len = slash ? static_cast<size_t>(slash - p) : std::strlen(p);
                    Text comp(p, len), joined;
                    join_path(with_ones.c_str(), len == 1 && *p == '*' ? "1" : comp.c_str(), joined);
                    with_ones = joined;
                    p = slash ? slash + 1 : p + len;
                }
                Text base = c.dest;
                if (c.poly) join_path(c.dest.c_str(), "1", base);
                join_path(base.c_str(), with_ones.c_str(), tpl);
            }
            const ParamNode* tp = local_params_.resolve(tpl.c_str());
            if (!tp || !takes_values(tp)) continue;
            const ParamRole role = role_of(tp);
            auto add = [&](const uint8_t* chain, uint8_t levels, const Text& source_path, const Text& source_pop) {
                InboundEntry ie;
                ie.source_sku_hash = crc32_sku(c.source_sku.c_str());
                ie.source_sku = c.source_sku;
                ie.source_path = source_path;
                ie.source_pop = source_pop;
                // Its key: the destination's path with the source's slots
                Text key = c.dest;
                key += "#";
                for (uint8_t i = 0; i < levels; ++i) {
                    char k[8];
                    snprintf(k, sizeof(k), "%s%u", i ? "." : "", static_cast<unsigned>(chain[i]));
                    key += k;
                }
                key += "/";
                key += l.dest.c_str();
                ie.local_path = key;
                ie.id = c.id;
                ie.conn = static_cast<uint16_t>(ci);
                ie.link = static_cast<uint16_t>(li);
                ie.levels = levels;
                for (uint8_t i = 0; i < levels && i < InboundEntry::DEPTH; ++i) ie.chain[i] = chain[i];
                ie.role = role;
                if (!inbound_stream_.push_back(ie))
                    log("Out of memory: %s from %s/%s will not be received", ie.local_path.c_str(),
                        c.source_sku.c_str(), ie.source_path.c_str());
            };
            if (c.source_sku == identity_.sku) {
                if (const ParamNode* src = local_params_.resolve(c.source.c_str()))
                    each_chain(src, c.source.c_str(), c.poly, l.source, add);
            } else if (const NodeEntry* e = world_.find_node(c.source_sku.c_str())) {
                if (const auto* src = e->params.resolve(c.source.c_str()))
                    each_chain(src, c.source.c_str(), c.poly, l.source, add);
            }
        }
    }
    rebuild_picked_streams();
}

// A picked instance (9.1): each link from every slot of the source's
// population, and each slot's gate and id, watched for the pick even when
// no link takes them. Keyed like a population's: the destination, "#", the
// source's slot.
void Node::rebuild_picked_streams() {
    for (size_t ci = 0; ci < connections_.size(); ++ci) {
        const Connection& c = connections_[ci];
        if (!c.pick.any()) continue;
        Text pop, within;
        if (!split_pick(c.source, pop, within)) continue;
        uint8_t slots = 0;
        bool gated = false;
        auto each = [&](const auto* population) {
            if (!is_population(population)) return;
            slots = population->meta.slots;
            for (uint8_t k = 1; k <= slots; ++k) {
                char slot[4];
                snprintf(slot, sizeof(slot), "%u", static_cast<unsigned>(k));
                const auto* inst = child_named(population, slot);
                if (!inst) continue;
                Text inst_path, base;
                join_path(pop.c_str(), slot, inst_path);
                join_path(inst_path.c_str(), within.c_str(), base);
                const auto* at = follow(inst, within.c_str());
                auto add = [&](const Text& source_path, uint16_t link, ParamRole role, const char* tail) {
                    for (const auto& x : inbound_stream_)
                        if (x.conn == ci && x.pick_slot == k && x.source_path == source_path) return;
                    InboundEntry ie;
                    ie.source_sku_hash = crc32_sku(c.source_sku.c_str());
                    ie.source_sku = c.source_sku;
                    ie.source_path = source_path;
                    ie.local_path = c.dest;
                    ie.local_path += "#";
                    ie.local_path += slot;
                    ie.local_path += "/";
                    ie.local_path += tail;
                    ie.id = c.id;
                    ie.conn = static_cast<uint16_t>(ci);
                    ie.link = link;
                    ie.role = role;
                    ie.pick_slot = k;
                    if (!inbound_stream_.push_back(ie))
                        log("Out of memory: %s from %s/%s will not be received", ie.local_path.c_str(),
                            c.source_sku.c_str(), source_path.c_str());
                };
                for (size_t li = 0; li < c.links.size(); ++li) {
                    const Link& l = c.links[li];
                    if ((l.chosen && l.source.empty()) || std::strchr(l.dest.c_str(), '*') ||
                        std::strchr(l.source.c_str(), '*')) continue;
                    Text sp;
                    join_path(base.c_str(), l.source.c_str(), sp);
                    const auto* sn = at ? follow(at, l.source.c_str()) : nullptr;
                    const ParamRole r = sn && sn->meta.kind == ParamKind::Param ? role_of(sn) : ParamRole::None;
                    add(sp, static_cast<uint16_t>(li), r, l.dest.c_str());
                }
                for (ParamRole r : {ParamRole::Gate, ParamRole::Id}) {
                    const auto* w = with_role(inst, r);
                    if (!w) continue;
                    if (r == ParamRole::Gate) gated = true;
                    Text rel, sp;
                    rel_path(w, inst, rel);
                    join_path(inst_path.c_str(), rel.c_str(), sp);
                    add(sp, ParamSubscription::NONE, r, r == ParamRole::Gate ? "~gate" : "~id");
                }
            }
        };
        if (c.source_sku == identity_.sku) each(local_params_.resolve(pop.c_str()));
        else if (const NodeEntry* e = world_.find_node(c.source_sku.c_str())) each(e->params.resolve(pop.c_str()));

        // Its slots' lives, kept across a relink when the shape stays
        Picked* pk = picked(c.id);
        if (!pk) {
            pk = picked_.emplace_back();
            if (!pk) continue;
            pk->conn = c.id;
        }
        const uint16_t links = static_cast<uint16_t>(c.links.size());
        if (pk->slots.size() != slots || pk->links != links) {
            pk->slots.clear();
            pk->last.clear();
            pk->have.clear();
            pk->current = 0;
            pk->links = links;
            for (uint8_t k = 0; k < slots; ++k) pk->slots.push_back(PickedSlot{});
            for (size_t i = 0; i < size_t(slots) * links; ++i) {
                pk->last.push_back(ParamValue{});
                pk->have.push_back(0);
            }
        }
        pk->gated = gated;
        if (pk->pick != c.pick) {                       // picks anew among what lives
            pk->pick = c.pick;
            repick(*pk, clock_.millis());
        }
    }
    for (size_t i = picked_.size(); i > 0; --i) {
        const Connection* c = find_connection(picked_[i - 1].conn);
        if (!c || !c->pick.any()) picked_.erase(picked_.begin() + static_cast<ptrdiff_t>(i - 1));
    }
}

// --- Connecting this node's destinations by the source's name ---

etl::string<36> Node::find_sku(const char* name_or_sku) const {
    for (int pass = 0; pass < 2; ++pass)
        for (const auto& e : world_.nodes())
            if ((pass == 1 || e.online) &&
                (e.identity.sku == name_or_sku || e.identity.label == name_or_sku))
                return e.identity.sku;
    return {};
}

void Node::listen(const char* path, const char* source, const char* source_path, const Pick& pick) {
    for (size_t i = listening_.size(); i > 0; --i) {
        const Listened& l = listening_[i - 1];
        if (l.path == path && l.source == source && l.source_path == source_path)
            listening_.erase(listening_.begin() + static_cast<ptrdiff_t>(i - 1));
    }
    Listened l;
    l.path = path;
    l.source = source;
    l.source_path = source_path;
    l.pick = pick;
    if (!listening_.push_back(std::move(l))) {
        log("Out of memory: %s will not listen to %s %s", path, source, source_path);
        return;
    }
    make_listened();
}

bool Node::stop_listening(const char* path, const char* source, const char* source_path) {
    for (size_t i = listening_.size(); i > 0; --i) {
        const Listened& l = listening_[i - 1];
        if (l.path == path && l.source == source && l.source_path == source_path)
            listening_.erase(listening_.begin() + static_cast<ptrdiff_t>(i - 1));
    }
    const etl::string<36> sku = find_sku(source);
    return !sku.empty() && unsubscribe(path, sku.c_str(), source_path);
}

// Made once each, when its source's node is in the world
void Node::make_listened() {
    for (size_t i = 0; i < listening_.size();) {
        const Listened& l = listening_[i];
        const etl::string<36> sku = find_sku(l.source.c_str());
        if (sku.empty()) { ++i; continue; }
        if (!subscribe(l.path.c_str(), sku.c_str(), l.source_path.c_str(), {}, l.pick))
            log("Connect %s to %s %s refused: no such destination here, or the kinds differ",
                l.path.c_str(), l.source.c_str(), l.source_path.c_str());
        listening_.erase(listening_.begin() + static_cast<ptrdiff_t>(i));
    }
}

} // namespace dataflou
