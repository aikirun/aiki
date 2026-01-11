import { useEffect, useState } from "react";

interface RelativeTimeProps {
	timestamp: number;
	className?: string;
}

function getRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) {
		return "just now";
	}
	if (minutes < 60) {
		return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
	}
	if (hours < 24) {
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	if (days < 7) {
		return `${days} day${days === 1 ? "" : "s"} ago`;
	}

	return new Date(timestamp).toLocaleDateString();
}

// Returns update interval in ms based on how old the timestamp is
function getUpdateInterval(timestamp: number): number | null {
	const diff = Date.now() - timestamp;
	const minutes = diff / 60_000;
	const hours = diff / 3_600_000;
	const days = diff / 86_400_000;

	if (minutes < 1) return 10_000; // < 1 min: update every 10s
	if (hours < 1) return 60_000; // < 1 hour: update every minute
	if (days < 1) return 3_600_000; // < 1 day: update every hour
	return null; // > 1 day: no updates needed
}

export function RelativeTime({ timestamp, className = "" }: RelativeTimeProps) {
	const [relativeTime, setRelativeTime] = useState(() => getRelativeTime(timestamp));

	useEffect(() => {
		const updateInterval = getUpdateInterval(timestamp);
		if (!updateInterval) return;

		const interval = setInterval(() => {
			setRelativeTime(getRelativeTime(timestamp));
		}, updateInterval);

		return () => clearInterval(interval);
	}, [timestamp]);

	return (
		<time
			dateTime={new Date(timestamp).toISOString()}
			className={className}
			title={new Date(timestamp).toLocaleString()}
		>
			{relativeTime}
		</time>
	);
}
