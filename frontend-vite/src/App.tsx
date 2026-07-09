import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LandingPage } from "./LandingPage";
import { MentorApp } from "./MentorApp";
import { DrawingPage } from "./DrawingPage";
import { AuthCallback } from "./AuthCallback";
import { RolePickPage } from "./RolePickPage";

export const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/welcome/role" element={<RolePickPage />} />
      <Route path="/app" element={<MentorApp />} />
      <Route path="/draw/:roomId" element={<DrawingPage />} />
    </Routes>
  </BrowserRouter>
);

