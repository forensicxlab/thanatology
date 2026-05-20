import React from "react";

interface UnixToISO8601UTCProps {
  timestamp: number; // Accepts seconds or milliseconds
}

export function unixToISO8601UTCString(ts: number): string {
  if (ts.toString().length === 10) {
    ts *= 1000;
  }
  const date = new Date(ts);
  const pad = (num: number, width = 2) => num.toString().padStart(width, "0");
  const padMicro = (ms: number) => (ms * 1000).toString().padStart(6, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}` +
    `.${padMicro(date.getUTCMilliseconds())}Z`
  );
}

const UnixToISO8601UTC: React.FC<UnixToISO8601UTCProps> = ({ timestamp }) => {
  return <span>{unixToISO8601UTCString(timestamp)}</span>;
};

export default UnixToISO8601UTC;
