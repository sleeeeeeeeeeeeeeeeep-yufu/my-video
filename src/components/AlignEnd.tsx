import React from "react";

export const AlignEnd: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>{children}</div>;
};
