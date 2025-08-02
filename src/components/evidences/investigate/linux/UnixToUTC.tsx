import React from "react";

interface UnixToISO8601UTCProps {
  timestamp: number; // Accepts seconds or milliseconds
}

const UnixToISO8601UTC: React.FC<UnixToISO8601UTCProps> = ({ timestamp }) => {
  const formatToISO8601 = (ts: number): string => {
    // Normalize to milliseconds if in seconds
    if (ts.toString().length === 10) {
      ts *= 1000;
    }

    const date = new Date(ts);

    const pad = (num: number, width = 2) => num.toString().padStart(width, "0");
    const padMicro = (ms: number) => (ms * 1000).toString().padStart(6, "0");

    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    const microseconds = padMicro(date.getUTCMilliseconds());

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${microseconds}Z`;
  };

  return <span>{formatToISO8601(timestamp)}</span>;
};

export default UnixToISO8601UTC;
