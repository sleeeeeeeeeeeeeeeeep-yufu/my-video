import React from "react";

export const InputContainer: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return (
    <div className="border border-gray-100 p-geist rounded-geist bg-white flex flex-col">
      {children}
    </div>
  );
};
