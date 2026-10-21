// Support Fins settings. Built from manager.rows (settings.py rows(), which comes from
// the shared options.json): one row per option, so nothing here is specific to an
// option -- a new setting on the site shows up here at the next build.
import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.3

import UM 1.7 as UM
import Cura 1.0 as Cura

UM.Dialog
{
    id: dialog
    title: "Support Fins settings"

    minimumWidth: UM.Theme.getSize("setting_control").width * 3
    minimumHeight: UM.Theme.getSize("modal_window_minimum").height
    width: minimumWidth
    height: Math.max(minimumHeight, Math.min(list.implicitHeight + UM.Theme.getSize("default_margin").height * 10,
                                             800 * screenScaleFactor))
    backgroundColor: UM.Theme.getColor("main_background")

    ScrollView
    {
        anchors.fill: parent
        anchors.bottomMargin: error.visible ? error.height + UM.Theme.getSize("default_margin").height : 0
        clip: true

        ColumnLayout
        {
            id: list
            width: dialog.width - UM.Theme.getSize("default_margin").width * 4
            spacing: UM.Theme.getSize("narrow_margin").height

            // Cura.ComboBox reads its empty-list text from an id `catalog` in the file using
            // it; without one each choice row logs a TypeError on open (#364). Here, not on
            // the dialog: UM.Dialog's children take Items only.
            UM.I18nCatalog { id: catalog; name: "cura" }

            Repeater
            {
                model: manager.rows

                delegate: ColumnLayout
                {
                    id: row
                    property var opt: modelData
                    Layout.fillWidth: true
                    spacing: UM.Theme.getSize("narrow_margin").height
                    visible: manager.visible.indexOf(opt.key) >= 0

                    UM.Label
                    {
                        visible: opt.section !== ""
                        text: opt.section
                        font: UM.Theme.getFont("medium_bold")
                        Layout.topMargin: UM.Theme.getSize("default_margin").height
                    }

                    RowLayout
                    {
                        Layout.fillWidth: true
                        spacing: UM.Theme.getSize("default_margin").width

                        UM.Label
                        {
                            id: label
                            text: opt.label + (opt.hint ? "  <font color='gray'>" + opt.hint + "</font>" : "")
                            textFormat: Text.RichText
                            Layout.preferredWidth: UM.Theme.getSize("setting_control").width
                            MouseArea { id: labelHover; anchors.fill: parent; hoverEnabled: true }
                            UM.ToolTip
                            {
                                text: opt.tooltip
                                visible: labelHover.containsMouse
                                targetPoint: Qt.point(label.width / 2, 0)
                                y: label.height
                            }
                        }

                        Loader
                        {
                            Layout.fillWidth: true
                            sourceComponent: opt.type === "bool" ? boolControl
                                : opt.type === "choice" ? choiceControl
                                : opt.slider ? sliderControl : numberControl
                        }
                    }

                    // Inside the delegate so they see its `opt`.
                    Component
                    {
                        id: boolControl
                        UM.CheckBox
                        {
                            checked: opt.value
                            onClicked: manager.setValue(opt.key, checked)
                        }
                    }

                    Component
                    {
                        id: choiceControl
                        Cura.ComboBox
                        {
                            implicitHeight: UM.Theme.getSize("setting_control").height
                            textRole: "label"
                            model: opt.choices
                            currentIndex: opt.index
                            onActivated: (index) => manager.setValue(opt.key, opt.choices[index].value)
                        }
                    }

                    Component
                    {
                        id: sliderControl
                        RowLayout
                        {
                            id: sliderRow
                            spacing: UM.Theme.getSize("default_margin").width
                            // The value is ours in a fixed-width column for every slider, not
                            // Cura's badge: that floats above the handle over the row above
                            // (#242). Sized for the widest value so it never shifts as the slider moves.
                            function shown(v) { return Math.round(v / opt.step) * opt.step + (opt.percent ? "%" : opt.hint) }
                            UM.Slider
                            {
                                id: slider
                                Layout.fillWidth: true
                                from: opt.min
                                to: opt.max
                                stepSize: opt.step
                                snapMode: Slider.SnapAlways
                                value: opt.value
                                indicatorVisible: false
                                onValueChanged: manager.setValue(opt.key, value)
                            }
                            UM.Label
                            {
                                text: sliderRow.shown(slider.value)
                                horizontalAlignment: Text.AlignRight
                                wrapMode: Text.NoWrap
                                Layout.preferredWidth: widest.advanceWidth
                                TextMetrics { id: widest; font: UM.Theme.getFont("default"); text: sliderRow.shown(opt.max) }
                            }
                        }
                    }

                    Component
                    {
                        id: numberControl
                        Cura.TextField
                        {
                            implicitHeight: UM.Theme.getSize("setting_control").height
                            text: opt.value
                            selectByMouse: true
                            // Digits with a point OR a comma, whatever the system locale:
                            // settings.py reads both. Written on every keystroke (not on
                            // editingFinished, which a click on Save doesn't trigger on
                            // macOS), and a value out of range is refused by name on Save.
                            validator: RegularExpressionValidator { regularExpression: /^\d*([.,]\d*)?$/ }
                            onTextEdited: manager.setValue(opt.key, text)
                        }
                    }
                }
            }
        }
    }

    UM.Label
    {
        id: error
        anchors.bottom: parent.bottom
        visible: manager.error !== ""
        text: manager.error
        color: UM.Theme.getColor("error")
        wrapMode: Text.Wrap
        width: parent.width
    }

    rightButtons: [
        Cura.TertiaryButton
        {
            text: "Cancel"
            onClicked: dialog.reject()
        },
        Cura.SecondaryButton
        {
            text: "Save"
            onClicked: if (manager.save()) dialog.accept()
        },
        Cura.PrimaryButton
        {
            text: "Save and add fins"
            onClicked: if (manager.save()) { dialog.accept(); manager.addToSelection() }
        }
    ]
}
