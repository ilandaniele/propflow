'use client';

import { useRef, useImperativeHandle, forwardRef } from 'react';

export interface SignatureCanvasHandle {
  getDataUrl: () => string | null;
  clear: () => void;
}

interface SignatureCanvasProps {
  onDrawn: (drawn: boolean) => void;
}

const SignatureCanvas = forwardRef<SignatureCanvasHandle, SignatureCanvasProps>(
  function SignatureCanvas({ onDrawn }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawing = useRef(false);

    useImperativeHandle(ref, () => ({
      getDataUrl() {
        return canvasRef.current?.toDataURL('image/png') ?? null;
      },
      clear() {
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          onDrawn(false);
        }
      },
    }));

    function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
      isDrawing.current = true;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      ctx.beginPath();
      ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }

    function draw(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!isDrawing.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      const canvas = canvasRef.current;
      if (!ctx || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
      onDrawn(true);
    }

    function endDraw() {
      isDrawing.current = false;
    }

    return (
      <canvas
        ref={canvasRef}
        width={380}
        height={120}
        className="w-full border border-slate-300 rounded-lg bg-white cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerDown={startDraw}
        onPointerMove={draw}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
        aria-label="Signature drawing pad"
      />
    );
  }
);

export default SignatureCanvas;
