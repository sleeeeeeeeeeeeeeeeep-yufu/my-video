import React, { useCallback } from "react";

export const Input: React.FC<{
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  disabled?: boolean;
}> = ({ text, setText, disabled }) => {
  const onChange: React.ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      setText(e.currentTarget.value);
    },
    [setText],
  );

  return (
    <input
      type="search"
      autoComplete="off"
      className="leading-[1.7] block w-full rounded-geist bg-white p-geist-half text-gray-800 text-sm border border-gray-200 transition-colors duration-150 ease-in-out focus:border-blue-300 outline-none"
      disabled={disabled}
      name="title"
      value={text}
      onChange={onChange}
    />
  );
};
