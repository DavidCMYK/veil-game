### **1. areas.json**



This defines world layout, scrolling structure, exits, and initial NPC placement.



##### **Top-level structure**

{

&nbsp; "AreaName": { ... },

&nbsp; "AnotherArea": { ... }

}





Each key is an area ID referenced everywhere else (area, currentAreaName, exits, rules).



##### Area object

###### Required / common fields

{

&nbsp; "defaultground": "ground\_bank\_1",

&nbsp; "backgrounds": \["forest\_background\_2"],

&nbsp; "sectioncount": 12,

&nbsp; "sections": { ... },

&nbsp; "leftarea": "OtherAreaName",

&nbsp; "rightarea": null

}



###### Optional visual layers

* distantbackgrounds: array or null
* backobjects: array or null
* foreobjects: array



Each object layer entry supports:



{

&nbsp; "name": "forest\_trunk\_1",

&nbsp; "height": 200,

&nbsp; "density": 0.5   // optional; if omitted, defaults apply

}



##### Sections

"sections": {

&nbsp; "section\_id": {

&nbsp;   "position": 4,

&nbsp;   "groundimage": "ground\_bank\_1",

&nbsp;   "foreobjects": \[],

&nbsp;   "characters": {

&nbsp;     "name": "Mira",

&nbsp;     "position": 100

&nbsp;   },

&nbsp;   "exits": { ... }

&nbsp; }

}



###### Supported fields



* position (required): ordering along the X-axis
* groundimage: overrides defaultground
* foreobjects: section-local foreground objects
* characters: spawn NPC here (single object, not array)
* exits: optional exit map



###### characters

"characters": {

&nbsp; "name": "Rowyn",

&nbsp; "position": 100

}





* name must match characters.json
* NPC is spawned in-world (not party)



###### exits

"exits": {

&nbsp; "1": {

&nbsp;   "direction": "up",

&nbsp;   "Position": 500,

&nbsp;   "targetexit": "Forest2.entrance1.1"

&nbsp; }

}





Notes:

* Exit keys ("1") are arbitrary identifiers
* targetexit syntax: Area.section.exitId
* Position is world X



###### Minimal section template

{

&nbsp; "position": 1,

&nbsp; "groundimage": "ground\_bank\_1"

}



### 2\. characters.json



Defines recruit requirements and event-driven rules.



##### Top-level structure

{

&nbsp; "Player": { ... },

&nbsp; "Rowyn": { ... },

&nbsp; "Mira": { ... }

}



##### Character object

###### Recruitment thresholds

{

&nbsp; "minalignment": 2,

&nbsp; "minaffection": 2

}



Used by addNpcToPartyInternal unless bypassChecks: true.



##### Rules

"rules": \[

&nbsp; {

&nbsp;   "id": "rowyn\_scene\_autostart\_test",

&nbsp;   "triggerWhen": { ... },

&nbsp;   "scopeWhen": { ... },

&nbsp;   "descopeWhen": { ... },

&nbsp;   "scene": { "start": "scene\_test\_0" },

&nbsp;   "once": true,

&nbsp;   "disabled": false

&nbsp; }

]



###### Rule lifecycle fields

* triggerWhen (required) → when this rule fires
* scopeWhen → when rule becomes active
* descopeWhen → when rule is deactivated
* once → auto-disable after firing once
* disabled → hard-disable



###### Supported triggerWhen / scopeWhen / descopeWhen

{ "event": "party\_join", "npc": "Rowyn" }

{ "event": "party\_leave", "npc": "Mira" }

{ "event": "section\_enter", "area": "Forest1", "sections": \["splitpath1"] }

{ "event": "dialog\_option", "npc": "Mira", "option": "0\_who" }





Fields:

* event (string, required)
* npc (string, optional)
* area (string, optional)
* sections (array of section IDs, optional)
* option (dialog option ID)



##### Rule effects (one or more)

###### Affection / alignment delta

"delta": { "affection": 1 }



###### Dialog prompt

"dialog": {

&nbsp; "prompt": "Hold on a minute...",

&nbsp; "start": "Splitpath Warning"

}



###### Scene autostart

"scene": { "start": "scene\_test\_0" }



###### Rule template

{

&nbsp; "id": "unique\_rule\_id",

&nbsp; "triggerWhen": { "event": "party\_join", "npc": "Mira" },

&nbsp; "delta": { "affection": -1 }

}



### 3\. Dialog / Scene JSON

These all share the same phrase system.



##### Top-level

{

&nbsp; "start": "0",

&nbsp; "phrases": { ... }

}



##### Phrase object – common fields

{

&nbsp; "speaker": "Rowyn",

&nbsp; "text": "Hello.",

&nbsp; "reaction": "worried",

&nbsp; "next": "1"

}



###### Supported fields

* speaker: NPC name (optional; omitted = narration)
* text: dialog text (optional if action-only)
* reaction: portrait/expression key
* next: string | object | null



##### Branching with next

###### Simple

"next": "1"



###### Conditional

"next": {

&nbsp; "A": { "when": { "party": { "hasAll": \["Rowyn"] } } },

&nbsp; "B": { "when": { "party": { "lacks": \["Rowyn"] } } }

}



###### Fallback

"next": {

&nbsp; "SomeBranch": { "when": { "alignment": { ">=": 5 } } },

&nbsp; "fallback": {}

}



##### Conditions (when)

###### Party

{ "party": \["Rowyn"] }

{ "party": { "hasAll": \["Rowyn"] } }

{ "party": { "lacks": \["Mira"] } }



###### Stats

{ "affection": { ">=": 6 } }

{ "alignment": { "<": "minalignment" } }



###### Flags

{ "areaFlags": { "metMira": true } }



##### Options (player choices)

"options": {

&nbsp; "0\_yes": {

&nbsp;   "text": "Yes",

&nbsp;   "next": "8",

&nbsp;   "alignmentEffect": 2,

&nbsp;   "affectionEffect": 0,

&nbsp;   "when": { "alignment": { ">=": 2 } }

&nbsp; }

}





Supported fields:

* text
* next
* alignmentEffect
* affectionEffect
* when
* addRules (adds rules dynamically)



##### Effects block

"effects": \[

&nbsp; { "type": "setFlag", "scope": "global", "key": "metMira" },

&nbsp; { "type": "lockControls" }

]





Supported effect types (from code):

* setFlag
* lockControls



### 4\. Action phrases (scenes)



A phrase with no dialog, only an action.



##### Common structure

{

&nbsp; "action": { ... },

&nbsp; "next": "another\_phrase"

}



##### Supported action types

###### moveTo

{

&nbsp; "type": "moveTo",

&nbsp; "actor": "Rowyn",

&nbsp; "worldX": 4000,

&nbsp; "speedFactor": 3

}



###### face

{

&nbsp; "type": "face",

&nbsp; "actor": "player",

&nbsp; "direction": "left"

}



###### wait

{

&nbsp; "type": "wait",

&nbsp; "durationMs": 1500

}



###### leaveParty

{

&nbsp; "type": "leaveParty",

&nbsp; "actor": "Rowyn",

&nbsp; "emit": false,

&nbsp; "toWorld": true,

&nbsp; "rememberIndex": true

}



###### joinParty

{

&nbsp; "type": "joinParty",

&nbsp; "actor": "Rowyn",

&nbsp; "emit": false,

&nbsp; "bypassChecks": true,

&nbsp; "index": "end"

}



###### index values

* number → explicit slot
* "remembered" → original slot from leaveParty
* "end" → next available slot



Action-only template

{

&nbsp; "action": { "type": "wait", "durationMs": 500 },

&nbsp; "next": null

}



5\. Mental model (important)

* areas.json = physical world
* characters.json = reactive logic + rules
* dialog/scene json = authored narrative flow
* actions = imperative, time-based world manipulation
* rules = declarative, event-driven state change
