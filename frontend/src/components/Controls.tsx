import type { Settings } from "../storage";
import { bindingLabel } from "../game/bindings";
import { useState } from "react";
import SettingsPanel from "./SettingsPanel";
export default function Controls({settings,onSettings}: {settings:Settings;onSettings:(settings:Settings)=>void}) {
  const [open,setOpen]=useState(false);
  const label = (action: Parameters<typeof bindingLabel>[1]) => bindingLabel(settings.bindings,action);
  return <div className="controls"><ul className="keys">
    <li>Pitch: {label("pitchDown")} / {label("pitchUp")}. Turn: {label("turnLeft")} / {label("turnRight")}.</li>
    <li>{label("boost")} boost · {label("brake")} brake (gamepad RT / LT).</li>
    <li>{label("barrelLeft")} / {label("barrelRight")} dodge 5 m (LB / RB).</li>
    <li>Adventure abilities: {label("flap")} wingbeat · {label("hover")} hover-stall · {label("plunge")} plunge · {label("burst")} Gale Force.</li>
    <li>{label("respawn")} respawn · {label("mute")} mute · {label("pause")} pause.</li>
    <li>Steering banks up to 80°. Escape frees the mouse.</li>
    <li>Touch screens: drag anywhere to steer, or turn on Tilt and steer by tilting; buttons for the rest.</li>
  </ul><button onClick={()=>setOpen(true)}>Settings</button>
  {open && <SettingsPanel settings={settings} onSettings={onSettings} onClose={()=>setOpen(false)} />}</div>;
}
