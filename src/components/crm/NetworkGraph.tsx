import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useCrmStore, NetworkNode, NetworkLink } from '@/stores/crmStore';
import {
  Network as NetworkIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Link2,
  Link,
  X,
} from 'lucide-react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom node component
const ContactNode = ({ data }: { data: NetworkNode & { selected: boolean; isConnecting?: boolean; isFirstConnection?: boolean; isSecondConnection?: boolean } }) => {
  const categoryColors: Record<string, string> = {
    Colleague: '#3b82f6',
    Client: '#22c55e',
    Vendor: '#a855f7',
    Friend: '#ec4899',
    Family: '#eab308',
    Other: '#6b7280',
  };

  const color = categoryColors[data.category] || '#6b7280';
  const score = Math.round(data.score);

  return (
    <div
      className={`px-3 py-2 rounded-lg shadow-lg transition-all cursor-pointer ${
        data.selected ? 'ring-2 ring-purple-500 ring-offset-2' : ''
      } ${
        data.isFirstConnection ? 'ring-2 ring-green-500 ring-offset-2 bg-green-50' : ''
      } ${
        data.isSecondConnection ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50' : ''
      } ${
        data.isConnecting ? 'hover:ring-2 hover:ring-orange-300 hover:ring-offset-1' : ''
      }`}
      style={{
        backgroundColor: 'white',
        border: `2px solid ${color}`,
        minWidth: '120px',
      }}
    >
      {/* Handles for edge connections */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-purple-500 !border-2 !border-white !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-purple-500 !border-2 !border-white !w-3 !h-3"
      />

      <div className="font-semibold text-gray-900 text-sm truncate">{data.label}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500">{data.value} emails</span>
        <span
          className={`text-xs font-bold ${
            score >= 80 ? 'text-green-600' :
            score >= 60 ? 'text-yellow-600' :
            score >= 40 ? 'text-orange-600' : 'text-gray-500'
          }`}
        >
          {score}
        </span>
      </div>
    </div>
  );
};

const nodeTypes = {
  contact: ContactNode,
};

export const NetworkGraph: React.FC = () => {
  const { networkData, fetchNetworkData, addManualConnection, removeManualConnection } = useCrmStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [minEmails, setMinEmails] = useState(3);
  const [initialized, setInitialized] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(['Colleague', 'Client', 'Vendor', 'Friend', 'Family', 'Other']));
  const [isConnectionMode, setIsConnectionMode] = useState(false);
  const [firstConnectionNode, setFirstConnectionNode] = useState<string | null>(null);
  const [networkDataLoaded, setNetworkDataLoaded] = useState(false);

  // Store node positions to preserve them during re-renders
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const convertToReactFlow = useCallback((data: typeof networkData) => {
    if (!data) return { nodes: [], edges: [] };

    console.log('[NetworkGraph] convertToReactFlow called with', data.nodes.length, 'nodes');

    // Filter nodes by selected categories
    const filteredNodes = data.nodes.filter(node => selectedCategories.has(node.category));
    console.log('[NetworkGraph] filteredNodes:', filteredNodes);

    // Get IDs of filtered nodes for edge filtering
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

    // Filter edges to only include connections between visible nodes
    const filteredLinks = data.links.filter(
      link => filteredNodeIds.has(link.source) && filteredNodeIds.has(link.target)
    );
    console.log('[NetworkGraph] filteredLinks:', filteredLinks);

    // Use the ref to preserve manual movements
    const existingPositions = nodePositionsRef.current;

    // Calculate positions based on relationship score (radial layout)
    // High score = closer to center, low score = outer edges
    const centerX = 500;
    const centerY = 350;
    const baseRadius = 100;
    const maxRadius = 350;

    // Sort nodes by score (highest first for center positioning)
    const sortedNodes = [...filteredNodes].sort((a, b) => b.score - a.score);

    const nodePositions = new Map<string, { x: number; y: number }>();

    sortedNodes.forEach((node, index) => {
      // Use existing position if available (preserves manual movements)
      if (existingPositions.has(node.id)) {
        nodePositions.set(node.id, existingPositions.get(node.id)!);
        return;
      }

      // Calculate radius based on score (higher score = closer to center)
      const scoreRatio = node.score / 100; // 0 to 1
      const radius = baseRadius + (maxRadius - baseRadius) * (1 - scoreRatio);

      // Calculate angle - distribute evenly around the circle
      const angle = (index / sortedNodes.length) * 2 * Math.PI;

      nodePositions.set(node.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });

    const flowNodes: Node[] = filteredNodes.map(node => {
      const position = nodePositions.get(node.id) || {
        x: Math.random() * 800,
        y: Math.random() * 600,
      };

      return {
        id: node.id,
        type: 'contact',
        position,
        data: {
          ...node,
          isConnecting: false,
          isFirstConnection: false,
          isSecondConnection: false,
        },
        zIndex: 1,
      };
    });

    // Update the ref with the new positions for next time
    nodePositionsRef.current = nodePositions;

    const flowEdges: Edge[] = filteredLinks.map(link => ({
      id: `${link.source}-${link.target}`,
      source: link.source,
      target: link.target,
      label: `${link.value} threads`,
      labelStyle: {
        fontSize: '10px',
        fontWeight: 600,
        fill: '#6b7280',
        backgroundColor: 'white',
        padding: '2px 4px',
      },
      labelShowBg: true,
      labelBgStyle: {
        fill: 'white',
        fillOpacity: 0.8,
        rx: 4,
        ry: 4,
      },
      style: {
        stroke: '#8b5cf6',
        strokeWidth: Math.max(3, Math.min(link.strength, 8)),
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        opacity: 1,
      },
      zIndex: 0,
      animated: true,
      type: 'default' as const,
    }));

    console.log('[NetworkGraph] Generated', flowNodes.length, 'nodes and', flowEdges.length, 'edges');
    console.log('[NetworkGraph] First edge:', flowEdges[0]);
    console.log('[NetworkGraph] Node IDs:', flowNodes.map(n => n.id));
    console.log('[NetworkGraph] Edge source/targets:', flowEdges.map(e => ({ source: e.source, target: e.target })));

    return { nodes: flowNodes, edges: flowEdges };
  }, [selectedCategories]);

  useEffect(() => {
    if (!networkData) {
      console.log('[NetworkGraph] Fetching network data...');
      fetchNetworkData(minEmails, 50);
    }
  }, []);

  // Initialize/update nodes/edges when network data or categories change
  useEffect(() => {
    console.log('[NetworkGraph] networkData changed:', networkData);
    console.log('[NetworkGraph] networkDataLoaded:', networkDataLoaded);

    if (networkData) {
      console.log('[NetworkGraph] Converting to ReactFlow...');
      const { nodes: flowNodes, edges: flowEdges } = convertToReactFlow(networkData);
      console.log('[NetworkGraph] Setting nodes:', flowNodes);
      console.log('[NetworkGraph] Setting edges:', flowEdges);
      setNodes(flowNodes);
      setEdges(flowEdges);
      setNetworkDataLoaded(true);
    }
  }, [networkData, convertToReactFlow, setNodes, setEdges]);

  // Update only the selected/connection state without changing positions
  useEffect(() => {
    if (networkDataLoaded) {
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            selected: node.id === selectedNode,
            isConnecting: isConnectionMode,
            isFirstConnection: firstConnectionNode === node.id,
          },
        }))
      );
    }
  }, [selectedNode, isConnectionMode, firstConnectionNode, networkDataLoaded, setNodes]);

  // Update edge visibility based on selected node
  useEffect(() => {
    if (networkDataLoaded) {
      setEdges((currentEdges) =>
        currentEdges.map((edge) => ({
          ...edge,
          hidden: selectedNode !== null
            ? edge.source !== selectedNode && edge.target !== selectedNode
            : false,
        }))
      );
    }
  }, [selectedNode, networkDataLoaded, setEdges]);

  // Update positions ref when nodes are moved manually
  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes);
    // Update the ref with new positions when nodes are moved
    changes.forEach((change: any) => {
      if (change.type === 'position' && change.position) {
        nodePositionsRef.current.set(change.id, change.position);
      }
    });
  }, [onNodesChange]);

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    if (isConnectionMode) {
      if (firstConnectionNode === null) {
        // First node selected
        setFirstConnectionNode(node.id);
      } else if (firstConnectionNode === node.id) {
        // Clicked same node, deselect
        setFirstConnectionNode(null);
      } else {
        // Second node selected, create connection
        addManualConnection(firstConnectionNode, node.id, 5);
        setFirstConnectionNode(null);
        setIsConnectionMode(false);
        // Trigger a refresh to update edges from the store
        setNetworkDataLoaded(false);
        setTimeout(() => setNetworkDataLoaded(true), 50);
      }
    } else {
      setSelectedNode(node.id === selectedNode ? null : node.id);
    }
  };

  const handleToggleConnectionMode = () => {
    setIsConnectionMode(!isConnectionMode);
    setFirstConnectionNode(null);
    setSelectedNode(null);
  };

  const handleCancelConnectionMode = () => {
    setIsConnectionMode(false);
    setFirstConnectionNode(null);
  };

  const handleCategoryToggle = (category: string) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(category)) {
      // Don't allow deselecting all categories
      if (newSelected.size > 1) {
        newSelected.delete(category);
      }
    } else {
      newSelected.add(category);
    }
    setSelectedCategories(newSelected);
  };

  const categoryColors: Record<string, string> = {
    Colleague: 'bg-blue-500',
    Client: 'bg-green-500',
    Vendor: 'bg-purple-500',
    Friend: 'bg-pink-500',
    Family: 'bg-yellow-500',
    Other: 'bg-gray-500',
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Network Visualization</h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          Visualize your email network - connections show shared threads between contacts.
        </p>
      </div>

      {/* Debug Info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mb-2 text-xs text-gray-400">
          Nodes: {nodes.length}, Edges: {edges.length}, Loaded: {networkDataLoaded ? 'yes' : 'no'}
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-400">Min Emails:</label>
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={minEmails === 0 ? '' : minEmails}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setMinEmails(0);
                } else {
                  const num = Number(value);
                  if (num >= 1) {
                    setMinEmails(num);
                    setInitialized(false);
                    fetchNetworkData(num, 50);
                  }
                }
              }}
              onFocus={(e) => e.target.select()}
              className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* Connection Mode Toggle */}
        <button
          onClick={handleToggleConnectionMode}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isConnectionMode
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {isConnectionMode ? (
            <>
              <Link className="w-4 h-4" />
              <span>Connecting...</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleCancelConnectionMode(); }}
                className="ml-1 p-0.5 rounded hover:bg-purple-200 dark:hover:bg-purple-800"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4" />
              <span>Add Connection</span>
            </>
          )}
        </button>
      </div>

      {/* Connection Mode Instructions */}
      {isConnectionMode && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            {firstConnectionNode ? (
              <>
                <span className="font-medium">First person selected</span> - Now click another person to create a connection, or click the same person to cancel.
              </>
            ) : (
              <>
                <strong>Connection Mode Active:</strong> Click on the first person you want to connect.
              </>
            )}
          </p>
        </div>
      )}

      {/* Legend with clickable categories */}
      <div className="mb-4 flex items-center gap-4 text-sm flex-wrap">
        <span className="text-gray-600 dark:text-gray-400">Categories:</span>
        {Object.entries(categoryColors).map(([category, color]) => {
          const isSelected = selectedCategories.has(category);
          return (
            <button
              key={category}
              onClick={() => handleCategoryToggle(category)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all ${
                isSelected
                  ? 'bg-gray-100 dark:bg-gray-700'
                  : 'bg-transparent opacity-40'
              }`}
            >
              <div className={`w-3 h-3 rounded-full ${color}`} />
              <span className="text-gray-700 dark:text-gray-300">{category}</span>
            </button>
          );
        })}
      </div>

      {/* Network Graph */}
      <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-800 relative">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p>No nodes to display</p>
              <p className="text-sm mt-1">Try lowering the "Min Emails" filter</p>
            </div>
          </div>
        ) : (
          <>
            <div className="absolute top-2 right-2 text-xs text-gray-400 z-10">
              {nodes.length} nodes, {edges.length} edges
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.2}
              maxZoom={2}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              selectNodesOnDrag={false}
            >
              <Background color="#aaa" gap={16} />
              <Controls
                className="bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"
              />
              <MiniMap
                nodeColor={(node) => {
                  const data = node.data as NetworkNode;
                  return categoryColors[data.category] || '#6b7280';
                }}
                className="bg-gray-100 dark:bg-gray-700"
              />
            </ReactFlow>
          </>
        )}
      </div>

      {/* Selected Node Info */}
      {selectedNode && networkData && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
          {(() => {
            const node = networkData.nodes.find(n => n.id === selectedNode);
            if (!node) return null;
            const connections = networkData.links.filter(
              l => l.source === selectedNode || l.target === selectedNode
            );
            return (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${categoryColors[node.category]}`}
                  >
                    {node.label.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">{node.label}</div>
                    <div className="text-sm text-gray-500">
                      {connections.length} connections • {node.value} emails
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Relationship Score</div>
                  <div className="text-xl font-bold text-purple-600">{Math.round(node.score)}</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Stats */}
      {networkData && (
        <div className="mt-4 grid grid-cols-4 gap-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-gray-900 dark:text-white">{networkData.nodes.length}</div>
            <div className="text-xs text-gray-500">Contacts</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-gray-900 dark:text-white">{networkData.links.length}</div>
            <div className="text-xs text-gray-500">Connections</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {networkData.links.reduce((sum, link) => sum + link.value, 0)}
            </div>
            <div className="text-xs text-gray-500">Total Threads</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {Math.round(networkData.nodes.reduce((sum, node) => sum + node.score, 0) / networkData.nodes.length) || 0}
            </div>
            <div className="text-xs text-gray-500">Avg Score</div>
          </div>
        </div>
      )}
    </div>
  );
};
