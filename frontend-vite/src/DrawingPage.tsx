import React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DrawingCanvas } from "./components/DrawingCanvas";

/**
 * Full-screen drawing canvas opened in a new tab.
 * URL: /draw/:roomId?name=Alice&role=teacher
 */
export const DrawingPage: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name") || "Anonymous";
  const role = searchParams.get("role") || "student";

  const decodedRoomId = roomId ? decodeURIComponent(roomId) : undefined;

  return (
    <div style={{ width: "100vw", height: "100vh", background: "var(--editor-bg)", display: "flex", flexDirection: "column" }}>
      <DrawingCanvas
        roomId={decodedRoomId}
        userName={name}
        userRole={role}
        className="flex-1"
        isFullscreen
      />
    </div>
  );
};
