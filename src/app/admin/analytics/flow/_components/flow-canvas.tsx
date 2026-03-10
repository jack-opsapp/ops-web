'use client'

import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { FlowData } from '@/lib/admin/flow-types'
import { EntryNode } from './nodes/entry-node'
import { SectionNode } from './nodes/section-node'
import { ConversionNode } from './nodes/conversion-node'
import { DropoffNode } from './nodes/dropoff-node'
import { FlowEdge } from './edges/flow-edge'
import { DropoffEdge } from './edges/dropoff-edge'

const nodeTypes = {
  entry: EntryNode,
  section: SectionNode,
  conversion: ConversionNode,
  dropoff: DropoffNode,
}

const edgeTypes = {
  flow: FlowEdge,
  dropoff: DropoffEdge,
}

interface FlowCanvasProps {
  data: FlowData
  onNodeClick: (nodeId: string) => void
}

const SECTION_Y_START = 40
const SECTION_Y_GAP = 100
const ENTRY_X = 50
const SECTION_X = 320
const CONVERSION_X = 640
const DROPOFF_X = 560

export function FlowCanvas({ data, onNodeClick }: FlowCanvasProps) {
  const maxEdgeCount = useMemo(
    () => Math.max(1, ...data.edges.map(e => e.count)),
    [data.edges]
  )

  const sectionNodes = useMemo(
    () => data.nodes.filter(n => n.type === 'section'),
    [data.nodes]
  )
  const maxViews = useMemo(
    () => Math.max(1, ...sectionNodes.map(n => n.views)),
    [sectionNodes]
  )

  const rfNodes: Node[] = useMemo(() => {
    const nodes: Node[] = []
    const totalSectionHeight = sectionNodes.length * SECTION_Y_GAP

    // Entry node
    const entryNode = data.nodes.find(n => n.type === 'entry')
    if (entryNode) {
      nodes.push({
        id: 'entry',
        type: 'entry',
        position: { x: ENTRY_X, y: SECTION_Y_START + totalSectionHeight / 2 - 30 },
        data: { ...entryNode, onClick: onNodeClick },
      })
    }

    // Section nodes
    sectionNodes.forEach((sn, i) => {
      nodes.push({
        id: sn.id,
        type: 'section',
        position: { x: SECTION_X, y: SECTION_Y_START + i * SECTION_Y_GAP },
        data: { ...sn, onClick: onNodeClick, maxViews },
      })

      if (sn.dropoffCount > 0 && sn.dropoffRate > 0.05) {
        nodes.push({
          id: `dropoff-${sn.id}`,
          type: 'dropoff',
          position: { x: DROPOFF_X, y: SECTION_Y_START + i * SECTION_Y_GAP + 70 },
          data: { count: sn.dropoffCount, rate: sn.dropoffRate, sectionName: sn.id },
        })
      }
    })

    // Conversion node
    const convNode = data.nodes.find(n => n.type === 'conversion')
    if (convNode) {
      nodes.push({
        id: 'signup',
        type: 'conversion',
        position: { x: CONVERSION_X, y: SECTION_Y_START + totalSectionHeight / 2 - 30 },
        data: { ...convNode, onClick: onNodeClick },
      })
    }

    return nodes
  }, [data.nodes, sectionNodes, maxViews, onNodeClick])

  const rfEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = []

    for (const e of data.edges) {
      edges.push({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: 'flow',
        data: { count: e.count, isConversionPath: e.isConversionPath, maxCount: maxEdgeCount },
        animated: e.isConversionPath,
      })
    }

    for (const sn of sectionNodes) {
      if (sn.dropoffCount > 0 && sn.dropoffRate > 0.05) {
        edges.push({
          id: `${sn.id}->dropoff-${sn.id}`,
          source: sn.id,
          sourceHandle: 'dropoff',
          target: `dropoff-${sn.id}`,
          type: 'dropoff',
        })
      }
    }

    return edges
  }, [data.edges, sectionNodes, maxEdgeCount])

  const onNodeClickHandler = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type !== 'dropoff') {
        onNodeClick(node.id)
      }
    },
    [onNodeClick]
  )

  return (
    <div className="w-full h-full" style={{ minHeight: 500 }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClickHandler}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'flow' }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="rgba(255,255,255,0.03)" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-white/[0.04] !border-white/[0.08] !rounded [&_button]:!bg-transparent [&_button]:!border-white/[0.08] [&_button]:!text-[#6B6B6B] [&_button:hover]:!text-[#E5E5E5]"
        />
      </ReactFlow>
    </div>
  )
}
