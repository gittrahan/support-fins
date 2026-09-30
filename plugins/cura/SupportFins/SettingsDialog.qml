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
                            UM.Slider
                            {
                                id: slider
                                Layout.fillWidth: true
                                from: opt.min
                                to: opt.max
                                stepSize: opt.step
                                snapMode: Slider.SnapAlways
                                value: opt.value
                                // Cura's badge always reads "%": only right for a percent option
                                indicatorVisible: opt.percent
                                onValueChanged: manager.setValue(opt.key, value)
                            }
                            UM.Label
                            {
                                visible: !opt.percent
                                text: Math.round(slider.value / opt.step) * opt.step + opt.hint
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
                            validator: DoubleValidator { bottom: opt.min; top: opt.max; notation: DoubleValidator.StandardNotation }
                            onEditingFinished: manager.setValue(opt.key, parseFloat(text))
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
