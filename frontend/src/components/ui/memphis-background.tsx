"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

/**
 * Memphis-style animated background shapes (Ocean Night).
 * Rendered once per page, positioned fixed behind all content.
 * Uses Framer Motion for continuous floating animations.
 */

const shapes = [
  // Dot grids
  { id: "dots-1", type: "dots", color: "var(--coral)", size: 220, top: "2%", left: "-2%", opacity: 0.1, dotSize: 4, gap: 22 },
  { id: "dots-2", type: "dots", color: "var(--sky)", size: 160, bottom: "8%", right: "3%", opacity: 0.08, dotSize: 3, gap: 18 },
  // Crosses
  { id: "cross-1", type: "cross", color: "var(--gold)", size: 50, bottom: "25%", left: "7%", opacity: 0.1 },
  // Rings
  { id: "ring-1", type: "ring", color: "var(--violet)", size: 70, top: "58%", right: "10%", opacity: 0.1 },
  // Triangles
  { id: "tri-1", type: "triangle", color: "var(--teal)", size: 44, top: "38%", left: "4%", opacity: 0.1 },
  { id: "tri-2", type: "triangle", color: "var(--blush)", size: 36, bottom: "12%", right: "22%", opacity: 0.08 },
  // Squares
  { id: "sq-1", type: "square", color: "var(--tangerine)", size: 30, top: "12%", left: "20%", opacity: 0.08, radius: 6 },
  { id: "sq-2", type: "square", color: "var(--sky)", size: 22, bottom: "30%", right: "15%", opacity: 0.07, radius: 4 },
] as const;

function getShapeStyle(shape: typeof shapes[number]): React.CSSProperties {
  const s: React.CSSProperties = {
    position: "absolute",
    willChange: "transform",
  };
  if ("top" in shape && shape.top) s.top = shape.top;
  if ("bottom" in shape && shape.bottom) s.bottom = shape.bottom;
  if ("left" in shape && shape.left) s.left = shape.left;
  if ("right" in shape && shape.right) s.right = shape.right;
  return s;
}

function ShapeElement({ shape, index }: { shape: typeof shapes[number]; index: number }) {
  const duration = 5 + Math.random() * 7;
  const xRange = 15 + Math.random() * 20;
  const yRange = 12 + Math.random() * 18;
  const rotRange = 8 + Math.random() * 15;

  const floatAnimation = {
    x: [0, xRange, -xRange * 0.5, xRange * 0.7, 0],
    y: [0, -yRange, yRange * 0.5, -yRange * 0.7, 0],
    rotate: [0, rotRange, -rotRange * 0.5, rotRange * 0.3, 0],
    scale: [1, 0.95, 1.05, 0.98, 1],
  };

  const style = getShapeStyle(shape);

  if (shape.type === "dots") {
    return (
      <motion.div
        style={{
          ...style,
          width: shape.size,
          height: shape.size,
          backgroundImage: `radial-gradient(${shape.color} ${shape.dotSize}px, transparent ${shape.dotSize}px)`,
          backgroundSize: `${shape.gap}px ${shape.gap}px`,
          opacity: shape.opacity,
        }}
        animate={floatAnimation}
        transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
      />
    );
  }

  if (shape.type === "cross") {
    return (
      <motion.div
        style={{ ...style, width: shape.size, height: shape.size, opacity: shape.opacity, position: "absolute" }}
        animate={floatAnimation}
        transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
      >
        <div style={{
          position: "absolute",
          width: shape.size,
          height: shape.size * 0.2,
          top: shape.size * 0.4,
          left: 0,
          background: shape.color,
          borderRadius: 4,
        }} />
        <div style={{
          position: "absolute",
          width: shape.size * 0.2,
          height: shape.size,
          top: 0,
          left: shape.size * 0.4,
          background: shape.color,
          borderRadius: 4,
        }} />
      </motion.div>
    );
  }

  if (shape.type === "ring") {
    return (
      <motion.div
        style={{
          ...style,
          width: shape.size,
          height: shape.size,
          border: `5px solid ${shape.color}`,
          borderRadius: "50%",
          opacity: shape.opacity,
        }}
        animate={floatAnimation}
        transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
      />
    );
  }

  if (shape.type === "triangle") {
    const half = shape.size / 2;
    const h = shape.size * 0.87;
    return (
      <motion.div
        style={{
          ...style,
          width: 0,
          height: 0,
          borderLeft: `${half}px solid transparent`,
          borderRight: `${half}px solid transparent`,
          borderBottom: `${h}px solid ${shape.color}`,
          opacity: shape.opacity,
        }}
        animate={floatAnimation}
        transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
      />
    );
  }

  if (shape.type === "square") {
    return (
      <motion.div
        style={{
          ...style,
          width: shape.size,
          height: shape.size,
          background: shape.color,
          borderRadius: ("radius" in shape ? shape.radius : 4),
          opacity: shape.opacity,
        }}
        animate={floatAnimation}
        transition={{ duration, repeat: Infinity, ease: "easeInOut", delay: index * 0.3 }}
      />
    );
  }

  return null;
}

export function MemphisBackground() {
  return (
    <div className="bm-memphis" aria-hidden="true">
      {/* Zigzag */}
      <motion.div
        style={{ position: "absolute", top: "18%", right: "6%", opacity: 0.12 }}
        animate={{
          x: [0, 15, -10, 12, 0],
          y: [0, -12, 8, -10, 0],
          rotate: [0, 8, -5, 6, 0],
        }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg width="180" height="80" viewBox="0 0 200 60" fill="none" stroke="var(--violet)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="10,50 30,10 50,50 70,10 90,50 110,10 130,50 150,10 170,50 190,10" />
        </svg>
      </motion.div>

      {/* Squiggle */}
      <motion.div
        style={{ position: "absolute", top: "72%", left: "18%", opacity: 0.09 }}
        animate={{
          x: [0, 18, -12, 15, 0],
          y: [0, -15, 10, -8, 0],
          rotate: [0, 10, -8, 5, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      >
        <svg width="120" height="50" viewBox="0 0 120 50" fill="none" stroke="var(--tangerine)" strokeWidth="3.5" strokeLinecap="round">
          <path d="M5,25 C20,5 35,45 50,25 C65,5 80,45 95,25 C110,5 115,25 115,25" />
        </svg>
      </motion.div>

      {shapes.map((shape, i) => (
        <ShapeElement key={shape.id} shape={shape} index={i} />
      ))}
    </div>
  );
}
