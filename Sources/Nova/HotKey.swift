import Carbon

/// A system-wide hotkey backed by Carbon's RegisterEventHotKey.
/// Works without Accessibility permission, unlike NSEvent global monitors.
final class HotKey {
    struct Modifiers: OptionSet {
        let rawValue: UInt32
        static let command = Modifiers(rawValue: UInt32(cmdKey))
        static let option = Modifiers(rawValue: UInt32(optionKey))
        static let control = Modifiers(rawValue: UInt32(controlKey))
        static let shift = Modifiers(rawValue: UInt32(shiftKey))
    }

    private static var handlers: [UInt32: @MainActor () -> Void] = [:]
    private static var nextID: UInt32 = 1
    private static var eventHandlerInstalled = false

    private var ref: EventHotKeyRef?
    private let id: UInt32

    init(keyCode: UInt32, modifiers: Modifiers, handler: @escaping @MainActor () -> Void) {
        id = HotKey.nextID
        HotKey.nextID += 1
        HotKey.handlers[id] = handler
        HotKey.installEventHandlerIfNeeded()

        let hotKeyID = EventHotKeyID(signature: OSType(0x4E4F5641) /* 'NOVA' */, id: id)
        let status = RegisterEventHotKey(keyCode, modifiers.rawValue, hotKeyID,
                                         GetApplicationEventTarget(), 0, &ref)
        if status != noErr {
            NSLog("Nova: failed to register hotkey (status \(status))")
        }
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        HotKey.handlers[id] = nil
    }

    private static func installEventHandlerIfNeeded() {
        guard !eventHandlerInstalled else { return }
        eventHandlerInstalled = true

        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
            var hotKeyID = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject),
                                           EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            guard status == noErr else { return status }
            let id = hotKeyID.id
            DispatchQueue.main.async {
                MainActor.assumeIsolated { HotKey.handlers[id]?() }
            }
            return noErr
        }, 1, &spec, nil, nil)
    }
}
