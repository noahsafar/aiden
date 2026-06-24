import React, { useEffect, useMemo, useRef } from 'react';
import { useCrmStore, NetworkNode } from '@/stores/crmStore';
import { Network as NetworkIcon } from 'lucide-react';
import { PersonAvatar } from '@/components/aiden/primitives';
import ReactFlow, {
  Node,
  Edge,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
  ReactFlowProvider,
} from 'reactflow';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceX,
  forceY,
  forceCollide,
} from 'd3-force';
import 'reactflow/dist/style.css';

/* ------------------------------------------------------------------ */
/* Palette — unified with Relationships `categoryTone`                 */
/* ------------------------------------------------------------------ */
const CATEGORY_COLOR: Record<string, string> = {
  Colleague: '#8b5cf6', // violet
  Client: '#10b981', // emerald
  Vendor: '#f59e0b', // amber
  Friend: '#0ea5e9', // sky
  Family: '#f43f5e', // rose
  Other: '#94a3b8', // slate
};
const CATEGORIES = ['Colleague', 'Client', 'Vendor', 'Friend', 'Family', 'Other'];

function nodeDiameter(score: number): number {
  return Math.round(44 + (Math.max(0, Math.min(100, score)) / 100) * 48); // 44–92px
}

/* ------------------------------------------------------------------ */
/* Node data + custom node                                             */
/* ------------------------------------------------------------------ */
interface GraphNodeData extends NetworkNode {
  email?: string;
  isVip?: boolean;
  cooling?: boolean;
  selected?: boolean;
  dimmed?: boolean;
}

const ContactNode = ({ data }: { data: GraphNodeData }) => {
  const color = CATEGORY_COLOR[data.category] || CATEGORY_COLOR.Other;
  const d = nodeDiameter(data.score);
  return (
    <div
      className="group relative flex flex-col items-center transition-opacity duration-300"
      style={{ width: d, opacity: data.dimmed ? 0.22 : 1 }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, top: '50%', left: '50%' }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, top: '50%', left: '50%' }} />
      <div
        className="relative rounded-full transition-transform duration-200 group-hover:scale-[1.06]"
        style={{
          width: d,
          height: d,
          boxShadow: data.selected
            ? `0 0 0 3px ${color}, 0 0 0 7px ${color}33, 0 8px 24px -6px ${color}66`
            : `0 0 0 2.5px ${color}, 0 4px 12px -4px rgba(0,0,0,0.25)`,
          borderRadius: '9999px',
          opacity: data.cooling && !data.selected ? 0.6 : 1,
        }}
      >
        <PersonAvatar name={data.label} email={data.email} size={d} />
        {data.isVip && (
          <div
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] shadow"
            style={{ color: '#fff' }}
            title="VIP"
          >
            ★
          </div>
        )}
        {data.cooling && (
          <div
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 2px #f59e0b`, opacity: 0.5, borderRadius: '9999px' }}
            title="Cooling — reach out"
          />
        )}
      </div>
      <div
        className="pointer-events-none mt-1.5 max-w-[110px] truncate text-center text-[11px] font-medium text-foreground"
        style={{ opacity: data.dimmed ? 0 : 1 }}
      >
        {data.label}
      </div>
    </div>
  );
};

const nodeTypes = { contact: ContactNode };

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */
interface NetworkGraphProps {
  selectedCategories?: Set<string>;
  selectedContactId?: string | null;
  onSelectContact?: (contactId: string) => void;
}

const NetworkGraphInner: React.FC<NetworkGraphProps> = ({
  selectedCategories,
  selectedContactId = null,
  onSelectContact,
}) => {
  const { networkData, fetchNetworkData, contacts } = useCrmStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (!networkData) fetchNetworkData();
  }, [networkData, fetchNetworkData]);

  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  // Compute a force-directed layout once per data/filter change, then freeze.
  const layout = useMemo(() => {
    if (!networkData) return { nodes: [] as Node[], edges: [] as Edge[] };
    const cats = selectedCategories ?? new Set(CATEGORIES);
    const visible = networkData.nodes.filter((n) => cats.has(n.category));
    const visibleIds = new Set(visible.map((n) => n.id));
    const links = networkData.links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target));

    // Category anchor points on a wide ring → clusters separate cleanly.
    const anchor = (cat: string) => {
      const i = Math.max(0, CATEGORIES.indexOf(cat));
      const a = (i / CATEGORIES.length) * 2 * Math.PI;
      return { x: 480 + 300 * Math.cos(a), y: 360 + 300 * Math.sin(a) };
    };

    const simNodes = visible.map((n) => ({ ...n }) as any);
    const simLinks = links.map((l) => ({ ...l })) as any;

    forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-220))
      .force('link', forceLink(simLinks).id((d: any) => d.id).distance(95).strength(0.2))
      .force('x', forceX((d: any) => anchor(d.category).x).strength(0.13))
      .force('y', forceY((d: any) => anchor(d.category).y).strength(0.13))
      .force('collide', forceCollide((d: any) => nodeDiameter(d.score) / 2 + 16))
      .stop()
      .tick(320);

    const flowNodes: Node[] = simNodes.map((n: any) => {
      const c = contactById.get(n.id);
      const pos = positionsRef.current.get(n.id) || { x: n.x ?? 0, y: n.y ?? 0 };
      positionsRef.current.set(n.id, pos);
      return {
        id: n.id,
        type: 'contact',
        position: pos,
        data: {
          ...n,
          email: c?.email_address,
          isVip: c?.is_vip,
          cooling: (c?.days_since_contact ?? 0) > 30 && n.score >= 50,
        } as GraphNodeData,
      };
    });

    const flowEdges: Edge[] = links.map((l) => ({
      id: `${l.source}-${l.target}`,
      source: l.source,
      target: l.target,
      type: 'straight',
      style: {
        stroke: '#cbd5e1',
        strokeWidth: 1 + Math.min(l.value / 3, 3),
        opacity: 0.4,
      },
    }));

    return { nodes: flowNodes, edges: flowEdges };
    // contactById intentionally excluded — positions are stable per data/filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkData, selectedCategories]);

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  // Selection → highlight the selected node + its neighbors, dim the rest,
  // and light up only the connected edges.
  useEffect(() => {
    const connected = new Set<string>();
    if (selectedContactId) {
      connected.add(selectedContactId);
      for (const e of layout.edges) {
        if (e.source === selectedContactId) connected.add(e.target);
        if (e.target === selectedContactId) connected.add(e.source);
      }
    }
    setNodes((cur) =>
      cur.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === selectedContactId,
          dimmed: selectedContactId ? !connected.has(n.id) : false,
        },
      })),
    );
    setEdges((cur) =>
      cur.map((e) => {
        const active = !!selectedContactId && (e.source === selectedContactId || e.target === selectedContactId);
        return {
          ...e,
          animated: active,
          style: {
            ...e.style,
            stroke: active ? '#8b5cf6' : '#cbd5e1',
            opacity: selectedContactId ? (active ? 0.9 : 0.08) : 0.4,
          },
        };
      }),
    );
  }, [selectedContactId, layout.edges, setNodes, setEdges]);

  const handleNodesChange = (changes: any) => {
    onNodesChange(changes);
    changes.forEach((ch: any) => {
      if (ch.type === 'position' && ch.position) positionsRef.current.set(ch.id, ch.position);
    });
  };

  if (!networkData) {
    // Loading constellation
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="relative h-24 w-24">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="absolute h-3 w-3 rounded-full bg-violet-400/40 animate-pulse-subtle"
              style={{
                top: `${50 + 38 * Math.sin((i / 5) * 2 * Math.PI)}%`,
                left: `${50 + 38 * Math.cos((i / 5) * 2 * Math.PI)}%`,
                animationDelay: `${i * 150}ms`,
              }}
            />
          ))}
        </div>
        <p className="text-sm text-muted">Mapping your network…</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.06]">
          <NetworkIcon className="h-5 w-5 text-muted" />
        </div>
        <div>
          <p className="text-[15px] font-semibold text-foreground">Your network is still forming</p>
          <p className="mt-1 max-w-xs text-[13px] text-muted">
            Once you've exchanged a few threads, the people in your world appear here, clustered by how you know them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelectContact?.(node.id)}
      onPaneClick={() => onSelectContact?.('')}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25, duration: 600 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(148 163 184 / 0.25)" />
      <Controls showInteractive={false} className="!shadow-elevated-sm !border-none [&>button]:!border-gray-200/70 [&>button]:!bg-white dark:[&>button]:!bg-white/[0.06]" />
    </ReactFlow>
  );
};

export const NetworkGraph: React.FC<NetworkGraphProps> = (props) => (
  <ReactFlowProvider>
    <NetworkGraphInner {...props} />
  </ReactFlowProvider>
);
