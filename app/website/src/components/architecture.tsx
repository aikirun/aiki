import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

import "./architecture.css";

type ViewId = "overview" | "server" | "handler" | "runtime" | "workers" | "endpoints";
type NavFn = (id: ViewId) => void;

const TITLES: Record<ViewId, string> = {
	overview: "Overview",
	server: "Server",
	handler: "Handler",
	runtime: "Runtime",
	workers: "Workers",
	endpoints: "Endpoints",
};

function ArrowMarker() {
	return (
		<defs>
			<marker
				id="arrow"
				viewBox="0 0 10 10"
				refX="8"
				refY="5"
				markerWidth="6"
				markerHeight="6"
				orient="auto-start-reverse"
			>
				<path
					d="M2 1L8 5L2 9"
					fill="none"
					stroke="context-stroke"
					strokeWidth={1.5}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</marker>
		</defs>
	);
}

/** A clickable diagram node that drills into another view. Keyboard-operable. */
function NavGroup({
	to,
	nav,
	className,
	children,
}: {
	to: ViewId;
	nav: NavFn;
	className: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: an SVG group has no native <button> equivalent; role + tabIndex + keydown is the accessible pattern for an interactive SVG shape.
		<g
			className={className}
			role="button"
			tabIndex={0}
			aria-label={`Open ${TITLES[to]} detail`}
			onClick={() => nav(to)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					nav(to);
				}
			}}
		>
			{children}
		</g>
	);
}

function overviewView(nav: NavFn) {
	return (
		<svg width="100%" viewBox="0 0 680 510">
			<ArrowMarker />
			<rect className="box" x="475" y="25" width="12" height="12" rx="2" strokeDasharray="3 2" strokeWidth={0.5} />
			<text className="ts" x="494" y="35" textAnchor="start">
				= pluggable / optional
			</text>
			<g className="c-purple">
				<rect x="120" y="25" width="300" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="270" y="45" textAnchor="middle" dominantBaseline="central">
					Your application
				</text>
				<text className="ts" x="270" y="63" textAnchor="middle" dominantBaseline="central">
					Aiki SDK client
				</text>
			</g>
			<line x1="185" y1="81" x2="185" y2="115" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-gray">
				<rect x="130" y="118" width="110" height="36" rx="8" strokeWidth={0.5} strokeDasharray="4 3" />
				<text className="ts" x="185" y="136" textAnchor="middle" dominantBaseline="central">
					Authorizer
				</text>
			</g>
			<g className="c-teal">
				<rect x="80" y="184" width="380" height="120" rx="16" strokeWidth={0.5} />
				<text className="th" x="270" y="210" textAnchor="middle" dominantBaseline="central">
					Aiki server
				</text>
				<text className="ts" x="270" y="228" textAnchor="middle" dominantBaseline="central">
					Orchestration, state machine, storage
				</text>
			</g>
			<NavGroup to="server" nav={nav} className="node c-teal">
				<rect x="110" y="244" width="150" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="185" y="266" textAnchor="middle" dominantBaseline="central">
					Handler
				</text>
			</NavGroup>
			<NavGroup to="server" nav={nav} className="node c-teal">
				<rect x="280" y="244" width="155" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="357" y="266" textAnchor="middle" dominantBaseline="central">
					Runtime
				</text>
			</NavGroup>
			<line x1="185" y1="154" x2="185" y2="242" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-coral">
				<rect x="500" y="184" width="140" height="280" rx="16" strokeWidth={0.5} strokeDasharray="6 4" />
				<text className="th" x="570" y="212" textAnchor="middle" dominantBaseline="central">
					Message
				</text>
				<text className="th" x="570" y="230" textAnchor="middle" dominantBaseline="central">
					transport
				</text>
			</g>
			<g className="c-coral">
				<rect x="515" y="250" width="110" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="570" y="272" textAnchor="middle" dominantBaseline="central">
					Publisher
				</text>
			</g>
			<g className="c-coral">
				<rect x="515" y="380" width="110" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="570" y="402" textAnchor="middle" dominantBaseline="central">
					Subscriber
				</text>
			</g>
			<line x1="570" y1="294" x2="570" y2="378" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<line
				x1="435"
				y1="272"
				x2="513"
				y2="272"
				stroke="#0f6e56"
				strokeWidth={1.5}
				fill="none"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="474" y="262" textAnchor="middle">
				publish
			</text>
			<NavGroup to="endpoints" nav={nav} className="node c-pink">
				<rect x="80" y="385" width="170" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="165" y="405" textAnchor="middle" dominantBaseline="central">
					Endpoints
				</text>
				<text className="ts" x="165" y="423" textAnchor="middle" dominantBaseline="central">
					Push-based, serverless
				</text>
			</NavGroup>
			<NavGroup to="workers" nav={nav} className="node c-blue">
				<rect x="270" y="385" width="190" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="365" y="405" textAnchor="middle" dominantBaseline="central">
					Workers
				</text>
				<text className="ts" x="365" y="423" textAnchor="middle" dominantBaseline="central">
					Pull-based, long-lived
				</text>
			</NavGroup>
			<line x1="165" y1="304" x2="165" y2="383" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<text className="ts" x="185" y="340" textAnchor="start">
				push
			</text>
			<text className="ts" x="185" y="354" textAnchor="start">
				(signed HTTP)
			</text>
			<line x1="340" y1="304" x2="340" y2="383" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<text className="ts" x="360" y="340" textAnchor="start">
				HTTP subscriber
			</text>
			<text className="ts" x="360" y="354" textAnchor="start">
				(default)
			</text>
			<path d="M515 402L462 402" stroke="#993c1d" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
			<text className="ts" x="490" y="394" textAnchor="middle">
				subscribe
			</text>
			<path
				d="M110 441L110 478L55 478L55 300L78 300"
				className="e"
				strokeWidth={1}
				fill="none"
				strokeDasharray="4 3"
				markerEnd="url(#arrow)"
			/>
			<path d="M420 441L420 478L55 478" className="e" strokeWidth={1} fill="none" strokeDasharray="4 3" />
			<text className="ts" x="46" y="392" textAnchor="middle">
				Store
			</text>
			<text className="ts" x="46" y="406" textAnchor="middle">
				results
			</text>
		</svg>
	);
}

function serverView(nav: NavFn) {
	return (
		<svg width="100%" viewBox="0 0 680 380">
			<ArrowMarker />
			<text className="ts" x="270" y="20" textAnchor="middle">
				Incoming requests (SDK, dashboard)
			</text>
			<line x1="270" y1="28" x2="270" y2="52" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-teal">
				<rect x="60" y="56" width="500" height="280" rx="20" strokeWidth={0.5} />
				<text className="th" x="310" y="80" textAnchor="middle" dominantBaseline="central">
					Aiki server
				</text>
			</g>
			<NavGroup to="handler" nav={nav} className="node c-teal">
				<rect x="90" y="100" width="210" height="90" rx="12" strokeWidth={0.5} />
				<text className="th" x="195" y="130" textAnchor="middle" dominantBaseline="central">
					Handler
				</text>
				<text className="ts" x="195" y="150" textAnchor="middle" dominantBaseline="central">
					API routes, API surface
				</text>
				<text className="ts" x="195" y="166" textAnchor="middle" dominantBaseline="central">
					State machine, transitions
				</text>
			</NavGroup>
			<NavGroup to="runtime" nav={nav} className="node c-teal">
				<rect x="330" y="100" width="210" height="90" rx="12" strokeWidth={0.5} />
				<text className="th" x="435" y="130" textAnchor="middle" dominantBaseline="central">
					Runtime
				</text>
				<text className="ts" x="435" y="150" textAnchor="middle" dominantBaseline="central">
					Daemons, timer consumers
				</text>
				<text className="ts" x="435" y="166" textAnchor="middle" dominantBaseline="central">
					Outbox drain
				</text>
			</NavGroup>
			<line x1="195" y1="190" x2="195" y2="240" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<line x1="435" y1="190" x2="435" y2="240" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-blue">
				<rect x="90" y="244" width="450" height="70" rx="12" strokeWidth={0.5} />
				<text className="th" x="315" y="272" textAnchor="middle" dominantBaseline="central">
					Database
				</text>
				<text className="ts" x="315" y="292" textAnchor="middle" dominantBaseline="central">
					Source of truth for all state
				</text>
			</g>
			<line
				x1="542"
				y1="145"
				x2="600"
				y2="145"
				stroke="#0f6e56"
				strokeWidth={1.5}
				fill="none"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="612" y="140" textAnchor="start">
				To
			</text>
			<text className="ts" x="612" y="154" textAnchor="start">
				publisher
			</text>
		</svg>
	);
}

function handlerView() {
	return (
		<svg width="100%" viewBox="0 0 680 280">
			<ArrowMarker />
			<text className="ts" x="270" y="20" textAnchor="middle">
				Incoming request
			</text>
			<line x1="270" y1="28" x2="270" y2="56" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-teal">
				<rect x="60" y="60" width="420" height="200" rx="20" strokeWidth={0.5} />
				<text className="th" x="270" y="84" textAnchor="middle" dominantBaseline="central">
					Handler
				</text>
			</g>
			<g className="c-teal">
				<rect x="160" y="100" width="220" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="270" y="122" textAnchor="middle" dominantBaseline="central">
					API routes
				</text>
			</g>
			<line x1="270" y1="144" x2="270" y2="174" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-teal">
				<rect x="110" y="178" width="320" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="270" y="198" textAnchor="middle" dominantBaseline="central">
					State machine
				</text>
				<text className="ts" x="270" y="216" textAnchor="middle" dominantBaseline="central">
					Transitions, optimistic locking
				</text>
			</g>
			<line x1="432" y1="206" x2="500" y2="206" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-blue">
				<rect x="504" y="184" width="120" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="564" y="206" textAnchor="middle" dominantBaseline="central">
					Database
				</text>
			</g>
		</svg>
	);
}

function runtimeView() {
	return (
		<svg width="100%" viewBox="0 0 680 370">
			<ArrowMarker />
			<g className="c-teal">
				<rect x="40" y="20" width="530" height="330" rx="20" strokeWidth={0.5} />
				<text className="th" x="305" y="46" textAnchor="middle" dominantBaseline="central">
					Runtime
				</text>
			</g>
			<g className="c-teal">
				<rect x="70" y="68" width="190" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="165" y="88" textAnchor="middle" dominantBaseline="central">
					Timer daemons
				</text>
				<text className="ts" x="165" y="106" textAnchor="middle" dominantBaseline="central">
					Poll for due timestamps
				</text>
			</g>
			<g className="c-teal">
				<rect x="290" y="68" width="250" height="56" rx="8" strokeWidth={0.5} strokeDasharray="4 3" />
				<text className="th" x="415" y="88" textAnchor="middle" dominantBaseline="central">
					Sorted set consumers
				</text>
				<text className="ts" x="415" y="106" textAnchor="middle" dominantBaseline="central">
					Event-driven, atomic batch
				</text>
			</g>
			<line x1="165" y1="124" x2="165" y2="155" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<line x1="415" y1="124" x2="415" y2="155" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-teal">
				<rect x="70" y="158" width="470" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="305" y="178" textAnchor="middle" dominantBaseline="central">
					State transitions
				</text>
				<text className="ts" x="305" y="196" textAnchor="middle" dominantBaseline="central">
					Workflow lifecycle, optimistic locking
				</text>
			</g>
			<line x1="305" y1="214" x2="305" y2="244" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<text className="ts" x="325" y="234" textAnchor="start">
				Single transaction
			</text>
			<g className="c-teal">
				<rect x="205" y="248" width="200" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="305" y="270" textAnchor="middle" dominantBaseline="central">
					Outbox
				</text>
			</g>
			<line
				x1="407"
				y1="270"
				x2="580"
				y2="270"
				stroke="#0f6e56"
				strokeWidth={1.5}
				fill="none"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="590" y="264" textAnchor="start">
				To
			</text>
			<text className="ts" x="590" y="278" textAnchor="start">
				publisher
			</text>
			<line x1="305" y1="292" x2="305" y2="316" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-blue">
				<rect x="205" y="300" width="200" height="36" rx="8" strokeWidth={0.5} />
				<text className="th" x="305" y="318" textAnchor="middle" dominantBaseline="central">
					Database
				</text>
			</g>
		</svg>
	);
}

function workersView() {
	return (
		<svg width="100%" viewBox="0 0 700 310">
			<ArrowMarker />
			<g className="c-teal">
				<rect x="30" y="88" width="120" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="90" y="108" textAnchor="middle" dominantBaseline="central">
					Server
				</text>
				<text className="ts" x="90" y="126" textAnchor="middle" dominantBaseline="central">
					Claim API
				</text>
			</g>
			<g className="c-coral">
				<rect x="30" y="190" width="120" height="56" rx="8" strokeWidth={0.5} strokeDasharray="4 3" />
				<text className="th" x="90" y="210" textAnchor="middle" dominantBaseline="central">
					Message
				</text>
				<text className="ts" x="90" y="228" textAnchor="middle" dominantBaseline="central">
					transport
				</text>
			</g>
			<line x1="152" y1="112" x2="298" y2="112" className="e" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
			<line
				x1="152"
				y1="215"
				x2="298"
				y2="215"
				stroke="#993c1d"
				strokeWidth={1.5}
				fill="none"
				markerEnd="url(#arrow)"
			/>
			<g className="c-blue">
				<rect x="300" y="25" width="370" height="265" rx="20" strokeWidth={0.5} />
				<text className="th" x="485" y="48" textAnchor="middle" dominantBaseline="central">
					Worker
				</text>
				<text className="ts" x="485" y="64" textAnchor="middle" dominantBaseline="central">
					Your infrastructure
				</text>
			</g>
			<g className="c-blue">
				<rect x="320" y="94" width="150" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="395" y="114" textAnchor="middle" dominantBaseline="central">
					Poll loop
				</text>
				<text className="ts" x="395" y="132" textAnchor="middle" dominantBaseline="central">
					Capacity-aware
				</text>
			</g>
			<line x1="472" y1="122" x2="510" y2="122" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-blue">
				<rect x="512" y="94" width="135" height="56" rx="8" strokeWidth={0.5} />
				<text className="th" x="580" y="114" textAnchor="middle" dominantBaseline="central">
					Executor
				</text>
				<text className="ts" x="580" y="132" textAnchor="middle" dominantBaseline="central">
					Runs workflow
				</text>
			</g>
			<path
				d="M580 150L580 255L200 255L200 130L152 130"
				className="e"
				strokeWidth={1}
				fill="none"
				strokeDasharray="4 3"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="390" y="249" textAnchor="middle">
				Store results
			</text>
			<path
				d="M580 94L580 80L200 80L200 100L152 100"
				className="e"
				strokeWidth={1}
				fill="none"
				strokeDasharray="4 3"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="340" y="74" textAnchor="middle">
				Refresh claim
			</text>
			<path
				d="M512 138L490 138L490 198L152 198"
				stroke="#993c1d"
				strokeWidth={1}
				fill="none"
				strokeDasharray="4 3"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="340" y="192" textAnchor="middle">
				Heartbeat
			</text>
		</svg>
	);
}

function endpointsView() {
	return (
		<svg width="100%" viewBox="0 0 680 260">
			<ArrowMarker />
			<g className="c-teal">
				<rect x="40" y="40" width="130" height="170" rx="8" strokeWidth={0.5} />
				<text className="th" x="105" y="105" textAnchor="middle" dominantBaseline="central">
					Server
				</text>
			</g>
			<line x1="172" y1="95" x2="298" y2="95" stroke="#993556" strokeWidth={1.5} fill="none" markerEnd="url(#arrow)" />
			<text className="ts" x="234" y="87" textAnchor="middle">
				Signed HTTP
			</text>
			<g className="c-pink">
				<rect x="300" y="20" width="345" height="220" rx="20" strokeWidth={0.5} />
				<text className="th" x="472" y="44" textAnchor="middle" dominantBaseline="central">
					Endpoint
				</text>
				<text className="ts" x="472" y="60" textAnchor="middle" dominantBaseline="central">
					Serverless platform
				</text>
			</g>
			<g className="c-pink">
				<rect x="320" y="88" width="150" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="395" y="110" textAnchor="middle" dominantBaseline="central">
					Verify signature
				</text>
			</g>
			<line x1="472" y1="110" x2="498" y2="110" className="e" strokeWidth={1.5} markerEnd="url(#arrow)" />
			<g className="c-pink">
				<rect x="500" y="88" width="120" height="44" rx="8" strokeWidth={0.5} />
				<text className="th" x="560" y="103" textAnchor="middle" dominantBaseline="central">
					Executor
				</text>
				<text className="ts" x="560" y="121" textAnchor="middle" dominantBaseline="central">
					Runs workflow
				</text>
			</g>
			<path
				d="M560 132L560 155L172 155"
				className="e"
				strokeWidth={1}
				fill="none"
				strokeDasharray="4 3"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="385" y="149" textAnchor="middle">
				Refresh claim
			</text>
			<path
				d="M560 155L560 195L172 195"
				className="e"
				strokeWidth={1}
				fill="none"
				strokeDasharray="4 3"
				markerEnd="url(#arrow)"
			/>
			<text className="ts" x="385" y="189" textAnchor="middle">
				Store results
			</text>
		</svg>
	);
}

const VIEWS: Record<ViewId, (nav: NavFn) => ReactElement> = {
	overview: overviewView,
	server: serverView,
	handler: handlerView,
	runtime: runtimeView,
	workers: workersView,
	endpoints: endpointsView,
};

export function Architecture() {
	const [history, setHistory] = useState<ViewId[]>(["overview"]);
	const current = history[history.length - 1];
	const nav: NavFn = (id) => setHistory((previous) => [...previous, id]);
	const goTo = (index: number) => setHistory((previous) => previous.slice(0, index + 1));

	return (
		<div className="aiki-arch not-prose">
			<nav className="aiki-nav" aria-label="Architecture diagram breadcrumb">
				{history.map((id, index) => {
					const path = history.slice(0, index + 1).join("/");
					if (index === history.length - 1) {
						return (
							<span key={path} className="aiki-cur">
								{TITLES[id]}
							</span>
						);
					}
					return (
						<span key={path} className="aiki-crumb">
							<button type="button" onClick={() => goTo(index)}>
								{TITLES[id]}
							</button>
							<span className="aiki-sep">/</span>
						</span>
					);
				})}
			</nav>
			<div className="aiki-stage">{VIEWS[current](nav)}</div>
		</div>
	);
}
