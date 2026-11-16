import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useParams } from "react-router-dom";
import { LandingPage } from "./LandingPage";
import { MentorApp } from "./MentorApp";
import { DrawingPage } from "./DrawingPage";
import { AuthCallback } from "./AuthCallback";
import { RolePickPage } from "./RolePickPage";
import { DemoLauncher, DemoRoomView } from "./DemoPage";

/**
 * Invite link: /join/<code>. Remember the code and go to the app, which joins
 * the group once the visitor is signed in (after Google sign-in if needed).
 */
const JoinLink: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    const clean = (code || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 50);
    try { if (clean) sessionStorage.setItem("strawie:join", clean); } catch { /* storage off */ }
    navigate("/app", { replace: true });
  }, [code, navigate]);
  return null;
};

export const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/welcome/role" element={<RolePickPage />} />
      <Route path="/app" element={<MentorApp />} />
      <Route path="/join/:code" element={<JoinLink />} />
      <Route path="/draw/:roomId" element={<DrawingPage />} />
      {/* Public demo, no account. /demo mints a room then redirects to it. */}
      <Route path="/demo" element={<DemoLauncher />} />
      <Route path="/demo/:roomId" element={<DemoRoomView />} />
    </Routes>
  </BrowserRouter>
);

